#include "frame_validate.h"

#include <cctype>
#include <string>

namespace {

bool iequals(const std::string& a, const char* b) {
    size_t n = 0;
    while (b[n] != '\0') ++n;
    if (a.size() != n) return false;
    for (size_t i = 0; i < n; ++i) {
        if (std::tolower(static_cast<unsigned char>(a[i])) !=
            std::tolower(static_cast<unsigned char>(b[i]))) return false;
    }
    return true;
}

std::string trim(const std::string& s) {
    size_t i = 0, j = s.size();
    while (i < j && std::isspace(static_cast<unsigned char>(s[i]))) ++i;
    while (j > i && std::isspace(static_cast<unsigned char>(s[j - 1]))) --j;
    return s.substr(i, j - i);
}

}  // namespace

FrameValidation validate_content_length(uint32_t content_length) {
    if (content_length == FRAME_EXPECTED_BYTES) return FrameValidation::Ok;
    if (content_length > FRAME_EXPECTED_BYTES) return FrameValidation::TooLarge;
    return FrameValidation::BadSize;  // includes 0 / missing
}

FrameValidation validate_content_type(const std::string& content_type) {
    if (content_type.empty()) return FrameValidation::BadContentType;
    // Strip parameters: "application/octet-stream; charset=binary" → type only.
    auto semi = content_type.find(';');
    std::string type = trim(semi == std::string::npos
                            ? content_type
                            : content_type.substr(0, semi));
    if (iequals(type, "application/octet-stream")) return FrameValidation::Ok;
    return FrameValidation::BadContentType;
}

bool parse_full_refresh_query(const std::string& query) {
    // Match "full=1" exactly, possibly with leading "?" and surrounding "&".
    // Strict: "full=1" is the only truthy form.
    std::string q = query;
    if (!q.empty() && q.front() == '?') q.erase(q.begin());
    size_t pos = 0;
    while (pos <= q.size()) {
        size_t amp = q.find('&', pos);
        std::string pair = q.substr(pos, amp == std::string::npos ? std::string::npos
                                                                  : amp - pos);
        if (pair == "full=1") return true;
        if (amp == std::string::npos) break;
        pos = amp + 1;
    }
    return false;
}

FrameError to_error(FrameValidation v) {
    switch (v) {
        case FrameValidation::BadSize:
            return {400, "bad_size",
                    "Content-Length must equal 48000"};
        case FrameValidation::TooLarge:
            return {413, "too_large",
                    "Content-Length exceeds 48000"};
        case FrameValidation::BadContentType:
            return {415, "bad_content_type",
                    "Content-Type must be application/octet-stream"};
        case FrameValidation::Ok:
        default:
            return {200, "ok", "ok"};
    }
}
