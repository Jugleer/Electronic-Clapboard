#pragma once

// Phase 16: the CAN field transaction — reassemble chunks, validate on
// commit, apply as a patch.
//
// Header-only and Arduino-free so it links into [env:native]. The Arduino
// side (can.cpp) does transport and rendering; every rule about what
// constitutes a valid transaction lives here, where it can be tested without
// a bus.
//
// TRANSACTION SHAPE (protocol.md §8.3-8.6)
//   ...CLAP_FIELD × N ... CLAP_COMMIT → CLAP_ACK
//
// There is no explicit "begin" frame. A transaction opens implicitly on the
// first chunk after the previous one closed, which keeps the wire minimal at
// the cost of the staging discipline below.
//
// PATCH, NOT REPLACE. Fields absent from the commit mask keep their previous
// values, so ROS2 can bump a take number without resending the scene
// description. That is why staging is separate from the live values: a
// half-arrived transaction must not be visible, and an abandoned one must
// not leak into the next.

#include <cstdint>
#include <cstring>

#include "can_frames.h"

namespace clap_txn {

constexpr uint8_t MAX_FIELDS = can_frames::MAX_FIELDS;       // 8
constexpr uint8_t MAX_CHARS  = can_frames::MAX_FIELD_CHARS;  // 32

struct CommitResult {
    can_frames::Outcome outcome;
    // True when the caller should re-render. False for every rejection AND
    // for an idempotent replay, where the panel already shows the result.
    bool                apply;
    // Fields whose value actually changed, for logging.
    uint8_t             changed_mask;
};

class Txn {
public:
    void reset() {
        memset(staging_, 0, sizeof(staging_));
        memset(values_,  0, sizeof(values_));
        staged_mask_   = 0;
        last_txn_id_   = 0;
        has_committed_ = false;
        last_outcome_  = can_frames::Outcome::Ok;
    }

    // Drop any partially-staged transaction without touching committed
    // values. Called when the link drops: a transaction interrupted by a
    // cable pull must not silently complete when the cable comes back.
    void abandon_staging() {
        memset(staging_, 0, sizeof(staging_));
        staged_mask_ = 0;
    }

    // Stage one chunk. `c` has already been range-checked by
    // can_frames::decode_field_chunk, so field_id and seq are in bounds.
    void add_chunk(const can_frames::FieldChunk& c) {
        const uint16_t off = (uint16_t) c.seq * can_frames::CHUNK_PAYLOAD;
        for (uint8_t i = 0; i < can_frames::CHUNK_PAYLOAD; ++i) {
            const uint16_t dst = (uint16_t)(off + i);
            // The 5th chunk carries 35 bytes of capacity against a 32-char
            // limit; the tail is pad and is deliberately dropped rather than
            // overrunning the buffer.
            if (dst >= MAX_CHARS) break;
            staging_[c.field_id][dst] = c.text[i];
        }
        staged_mask_ = (uint8_t)(staged_mask_ | (1u << c.field_id));
    }

    // Close a transaction.
    //
    // `renderer_busy` and `template_present` are the caller's world; keeping
    // them as arguments rather than callbacks is what lets the whole decision
    // table be exercised natively.
    CommitResult commit(const can_frames::Commit& cm,
                        bool renderer_busy,
                        bool template_present) {
        CommitResult r{};

        // Idempotent replay. A lost CLAP_ACK is the one retry the sender is
        // allowed, and without this the replay would find staging already
        // cleared and answer INCOMPLETE — telling ROS2 a transaction failed
        // when the panel is in fact showing it.
        if (has_committed_ && cm.txn_id == last_txn_id_) {
            r.outcome      = last_outcome_;
            r.apply        = false;
            r.changed_mask = 0;
            return r;
        }

        if (renderer_busy) {
            // Deliberately NOT recorded as last_outcome_: BUSY is transient
            // and the sender is expected to try again with the same txn_id,
            // which must then be treated as a fresh attempt rather than
            // replayed as a busy result forever.
            r.outcome = can_frames::Outcome::Busy;
            return r;
        }

        if (!template_present) {
            return finish(cm, can_frames::Outcome::NoTemplate, r);
        }

        // Every field named in the mask must have received at least one
        // chunk. A field named but never sent is a sender bug, and applying
        // it would blank a field that previously held a good value.
        if ((cm.field_present_mask & staged_mask_) != cm.field_present_mask) {
            return finish(cm, can_frames::Outcome::Incomplete, r);
        }

        // CRC over the 32-byte NUL-padded staging buffers of the masked
        // fields, ascending. Fixed width rather than trimmed strings is what
        // makes this independent of chunk arrival order — see §8.4.
        const uint16_t crc =
            can_frames::crc16_over_fields(staging_, cm.field_present_mask);
        if (crc != cm.crc16) {
            return finish(cm, can_frames::Outcome::CrcMismatch, r);
        }

        // Apply. Only now does anything become visible: a rejected
        // transaction leaves every committed value exactly as it was.
        uint8_t changed = 0;
        for (uint8_t f = 0; f < MAX_FIELDS; ++f) {
            if (!(cm.field_present_mask & (1u << f))) continue;
            if (memcmp(values_[f], staging_[f], MAX_CHARS) != 0) {
                changed = (uint8_t)(changed | (1u << f));
            }
            memcpy(values_[f], staging_[f], MAX_CHARS);
            values_[f][MAX_CHARS] = '\0';
        }

        CommitResult ok = finish(cm, can_frames::Outcome::Ok, r);
        ok.apply        = true;
        ok.changed_mask = changed;
        return ok;
    }

    // NUL-terminated committed value. Never null.
    const char* value(uint8_t field_id) const {
        if (field_id >= MAX_FIELDS) return "";
        return values_[field_id];
    }

    // Set a value outside the CAN path — the date autofill uses this.
    // Deliberately does not touch staging or the txn id: a firmware-set
    // value is not a transaction and must not make a replay look stale.
    void set_value(uint8_t field_id, const char* s) {
        if (field_id >= MAX_FIELDS) return;
        memset(values_[field_id], 0, MAX_CHARS + 1);
        if (!s) return;
        for (uint8_t i = 0; i < MAX_CHARS && s[i]; ++i) values_[field_id][i] = s[i];
    }

    void clear_values() { memset(values_, 0, sizeof(values_)); }

    uint8_t             last_txn_id() const { return last_txn_id_; }
    can_frames::Outcome last_outcome() const { return last_outcome_; }
    uint8_t             staged_mask() const { return staged_mask_; }

private:
    // Record the outcome, close the transaction, and clear staging so the
    // next chunk starts clean. Runs for every terminal outcome including
    // rejections — an abandoned bad transaction must not contaminate the
    // one after it.
    CommitResult& finish(const can_frames::Commit& cm,
                         can_frames::Outcome outcome,
                         CommitResult& r) {
        last_txn_id_   = cm.txn_id;
        last_outcome_  = outcome;
        has_committed_ = true;
        memset(staging_, 0, sizeof(staging_));
        staged_mask_   = 0;
        r.outcome      = outcome;
        r.apply        = false;
        r.changed_mask = 0;
        return r;
    }

    uint8_t staging_[MAX_FIELDS][MAX_CHARS];
    char    values_[MAX_FIELDS][MAX_CHARS + 1];
    uint8_t staged_mask_   = 0;
    uint8_t last_txn_id_   = 0;
    bool    has_committed_ = false;
    can_frames::Outcome last_outcome_ = can_frames::Outcome::Ok;
};

}  // namespace clap_txn
