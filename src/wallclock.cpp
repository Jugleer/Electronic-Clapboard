#include "wallclock.h"

#include <Arduino.h>
#include <time.h>

#include "clap_log.h"

namespace {
// pool.ntp.org is the broadest path; the chip will accept the first
// reply. v2 may add a fallback configurable list, but for v1 a single
// well-known pool is enough — if the LAN is firewalled, NTP fails and
// the firmware stays in round_robin (documented behaviour).
constexpr const char* NTP_SERVER_1 = "pool.ntp.org";
constexpr const char* NTP_SERVER_2 = "time.google.com";

bool g_sync_kicked = false;
}  // namespace

namespace wallclock {

void sync_async() {
    if (g_sync_kicked) return;
    g_sync_kicked = true;
    // configTime() with TZ "" + 0/0 GMT offsets keeps the system clock
    // in UTC. We don't care about local time — wallclock_hybrid does
    // (unix_seconds / cycle_interval_s) mod N which is timezone-
    // invariant. Using UTC means two devices in different timezones
    // still synchronise their slot picks.
    configTime(/*gmtOffset_sec=*/0, /*daylightOffset_sec=*/0,
               NTP_SERVER_1, NTP_SERVER_2);
    clap_log("[wallclock] SNTP kicked: %s, %s", NTP_SERVER_1, NTP_SERVER_2);
}

bool is_synced() {
    const time_t now = time(nullptr);
    if (now < 0) return false;
    return static_cast<uint64_t>(now) >= SANITY_THRESHOLD_S;
}

uint64_t unix_seconds() {
    if (!is_synced()) return 0;
    return static_cast<uint64_t>(time(nullptr));
}

}  // namespace wallclock
