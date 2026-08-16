#pragma once

// Phase 15: persistent template storage in LittleFS.
//
// Sits alongside the Phase 10 screensaver store in the same `slate_data`
// partition, in a sibling directory:
//
//   /screensaver/slot_<n>.bin    48,000 B — existing, untouched
//   /templates/tmpl_<n>.bin      48,100 B — raster + region trailer
//
// Separate directories rather than one unified store, because the two
// artefacts differ in exactly the way that matters: a slate is a finished
// picture, a template is a picture plus a contract about where text goes.
// Merging them would mean either giving slates meaningless region metadata
// or making the manifest polymorphic, and it would mean rewriting the tested
// Phase 10 manifest code for no gain.
//
// Writes are atomic by the same discipline the screensaver uses: bytes land
// in `<path>.tmp`, then rename. A power cut mid-upload leaves the previous
// template intact, which matters because the alternative is a device that
// boots with half a template and no obvious way to tell.

#include <cstdint>

#include "region.h"

namespace template_store {

// Mount is shared with the screensaver — whichever begin() runs first mounts
// LittleFS. Call after screensaver::begin() so the ordering is explicit.
// Reconciles the directory against what actually parses: a tmpl_<n>.bin that
// fails to load is removed rather than left to fail on every render.
void begin();

bool exists(uint8_t id);

// Load a template's region set. Returns false when absent or corrupt.
bool load(uint8_t id, region::Template& out);

// Read a template's 48,000-byte raster into `dst`. `dst` must have room for
// template_wire::RASTER_BYTES.
bool load_raster(uint8_t id, uint8_t* dst);

// Persist a complete 48,100-byte upload body. Validates the trailer before
// writing a single byte — a rejected upload must not disturb what is stored.
// Returns false on a parse failure or a filesystem error.
bool store(uint8_t id, const uint8_t* body, uint32_t len);

bool remove(uint8_t id);

// Bitmask of stored template ids, bit N = template N present. Used by
// GET /templates and by the boot log.
uint8_t present_mask();

}  // namespace template_store
