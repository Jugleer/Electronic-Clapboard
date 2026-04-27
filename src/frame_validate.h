#pragma once

// Pure C++ request validation for POST /frame.
//
// Lives outside Arduino-land so it links into both the firmware target
// and the host-side Unity test binary. Slugs and HTTP status codes are
// locked in docs/protocol.md §2.1.

#include <cstdint>
#include <string>

enum class FrameValidation {
    Ok,
    BadSize,         // 400 / "bad_size"
    TooLarge,        // 413 / "too_large"
    BadContentType,  // 415 / "bad_content_type"
};

// Expected raw frame size — protocol.md §1, locked.
constexpr uint32_t FRAME_EXPECTED_BYTES = 48000u;

// Hard upper bound used to choose between BadSize (mismatch) and TooLarge
// (refuse before reading body). Anything strictly greater than the expected
// frame size is "too large"; anything less is a size mismatch.
//
// We treat content_length == 0 / missing as BadSize, not a separate slug,
// because protocol.md §2.1 doesn't allocate a "length_required" code and
// re-using bad_size keeps the surface area small.
FrameValidation validate_content_length(uint32_t content_length);

// Tolerates parameters (e.g. "application/octet-stream; charset=binary") and
// is case-insensitive on the type/subtype per RFC 7231 §3.1.1.1.
FrameValidation validate_content_type(const std::string& content_type);

// "?full=1" → true. Anything else (absent, "0", "true", "yes") → false.
// Strict to avoid silently accepting malformed query strings.
bool parse_full_refresh_query(const std::string& query);

// Convenience: maps a validation outcome to the protocol-locked status code
// and slug. Caller assembles the JSON body.
struct FrameError {
    int         http_status;
    const char* slug;
    const char* message;
};
FrameError to_error(FrameValidation v);
