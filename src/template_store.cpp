#include "template_store.h"

#include <Arduino.h>
#include <LittleFS.h>
#include <cstdio>

#include "clap_log.h"
#include "template_wire.h"

namespace template_store {

namespace {

constexpr const char* DIR = "/templates";

uint8_t g_present = 0;

void path_for(uint8_t id, char* out, size_t n) {
    snprintf(out, n, "%s/tmpl_%u.bin", DIR, (unsigned) id);
}

void tmp_path_for(uint8_t id, char* out, size_t n) {
    snprintf(out, n, "%s/tmpl_%u.bin.tmp", DIR, (unsigned) id);
}

// A file is only counted present if its trailer actually parses. Checking
// existence alone would let a truncated upload sit in the mask and fail at
// render time, once per field update, forever.
bool verify(uint8_t id) {
    char p[48];
    path_for(id, p, sizeof(p));
    File f = LittleFS.open(p, "r");
    if (!f) return false;
    if (f.size() != template_wire::BODY_BYTES) { f.close(); return false; }

    uint8_t trailer[template_wire::TRAILER_BYTES];
    if (!f.seek(template_wire::RASTER_BYTES)) { f.close(); return false; }
    const size_t got = f.read(trailer, sizeof(trailer));
    f.close();
    if (got != sizeof(trailer)) return false;

    region::Template t{};
    return template_wire::parse_trailer(trailer, id, t) ==
           template_wire::ParseResult::Ok;
}

}  // namespace

void begin() {
    // LittleFS is mounted by screensaver::begin(); this only ensures the
    // directory exists. LittleFS creates parent dirs implicitly on open()
    // in arduino-esp32 v2.x, but mkdir keeps the listing tidy and makes an
    // empty install visibly intentional.
    if (!LittleFS.exists(DIR)) LittleFS.mkdir(DIR);

    g_present = 0;
    uint8_t dropped = 0;
    for (uint8_t id = 0; id < template_wire::MAX_TEMPLATES; ++id) {
        char p[48];
        path_for(id, p, sizeof(p));
        if (!LittleFS.exists(p)) continue;

        if (verify(id)) {
            g_present = (uint8_t)(g_present | (1u << id));
        } else {
            // Reconcile: a file that does not parse is worse than no file,
            // so drop it rather than carry a permanent render failure.
            LittleFS.remove(p);
            ++dropped;
        }
    }

    // Sweep orphaned .tmp files from an interrupted upload. They are never
    // valid — the rename is what commits — and left alone they leak the
    // partition 48 KB at a time.
    for (uint8_t id = 0; id < template_wire::MAX_TEMPLATES; ++id) {
        char t[48];
        tmp_path_for(id, t, sizeof(t));
        if (LittleFS.exists(t)) LittleFS.remove(t);
    }

    clap_log("[tmpl] store ready: present_mask=0x%02X%s",
             (unsigned) g_present,
             dropped ? " (dropped unparseable files)" : "");
}

bool exists(uint8_t id) {
    if (id >= template_wire::MAX_TEMPLATES) return false;
    return (g_present & (1u << id)) != 0;
}

bool load(uint8_t id, region::Template& out) {
    if (!exists(id)) return false;

    char p[48];
    path_for(id, p, sizeof(p));
    File f = LittleFS.open(p, "r");
    if (!f) return false;

    uint8_t trailer[template_wire::TRAILER_BYTES];
    if (!f.seek(template_wire::RASTER_BYTES)) { f.close(); return false; }
    const size_t got = f.read(trailer, sizeof(trailer));
    f.close();
    if (got != sizeof(trailer)) return false;

    return template_wire::parse_trailer(trailer, id, out) ==
           template_wire::ParseResult::Ok;
}

bool load_raster(uint8_t id, uint8_t* dst) {
    if (!exists(id) || !dst) return false;

    char p[48];
    path_for(id, p, sizeof(p));
    File f = LittleFS.open(p, "r");
    if (!f) return false;

    // Chunked read: File::read of 48 KB in one call works, but a short read
    // must be detected rather than leaving the tail of dst as whatever the
    // caller had there. Loop until satisfied or stalled.
    uint32_t off = 0;
    while (off < template_wire::RASTER_BYTES) {
        const int n = f.read(dst + off, template_wire::RASTER_BYTES - off);
        if (n <= 0) break;
        off += (uint32_t) n;
    }
    f.close();
    return off == template_wire::RASTER_BYTES;
}

bool store(uint8_t id, const uint8_t* body, uint32_t len) {
    if (id >= template_wire::MAX_TEMPLATES) {
        clap_log("[tmpl] store rejected: id %u >= MAX_TEMPLATES %u",
                 (unsigned) id, (unsigned) template_wire::MAX_TEMPLATES);
        return false;
    }
    if (!body || len != template_wire::BODY_BYTES) {
        clap_log("[tmpl] store rejected: len %lu != %lu",
                 (unsigned long) len, (unsigned long) template_wire::BODY_BYTES);
        return false;
    }

    // Validate BEFORE touching the filesystem. A rejected upload must leave
    // the stored template exactly as it was.
    region::Template parsed{};
    const auto pr = template_wire::parse_trailer(body + template_wire::RASTER_BYTES,
                                                 id, parsed);
    if (pr != template_wire::ParseResult::Ok) {
        clap_log("[tmpl] store rejected: trailer %s",
                 template_wire::parse_result_name(pr));
        return false;
    }

    char tmp[48], dst[48];
    tmp_path_for(id, tmp, sizeof(tmp));
    path_for(id, dst, sizeof(dst));

    File f = LittleFS.open(tmp, "w", /*create=*/true);
    if (!f) {
        clap_log("[tmpl] store failed: cannot open %s", tmp);
        return false;
    }
    const size_t written = f.write(body, template_wire::BODY_BYTES);
    f.close();
    if (written != template_wire::BODY_BYTES) {
        clap_log("[tmpl] store failed: wrote %u of %lu bytes (partition full?)",
                 (unsigned) written, (unsigned long) template_wire::BODY_BYTES);
        LittleFS.remove(tmp);
        return false;
    }

    if (LittleFS.exists(dst)) LittleFS.remove(dst);
    if (!LittleFS.rename(tmp, dst)) {
        clap_log("[tmpl] store failed: rename %s -> %s", tmp, dst);
        LittleFS.remove(tmp);
        return false;
    }

    g_present = (uint8_t)(g_present | (1u << id));
    clap_log("[tmpl] stored template %u (%u regions)",
             (unsigned) id, (unsigned) parsed.region_count);
    return true;
}

bool remove(uint8_t id) {
    if (id >= template_wire::MAX_TEMPLATES) return false;
    char p[48];
    path_for(id, p, sizeof(p));
    const bool ok = LittleFS.exists(p) ? LittleFS.remove(p) : true;
    if (ok) g_present = (uint8_t)(g_present & ~(1u << id));
    return ok;
}

uint8_t present_mask() { return g_present; }

}  // namespace template_store
