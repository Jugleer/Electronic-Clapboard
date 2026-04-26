#pragma once

// TCP log streamer. Listens on port 23 (telnet-style raw text). One client
// at a time; second connections are rejected immediately with a one-line
// notice. The connected client receives the last ~8 KB of buffered log
// history on connect, then live-streamed lines until they disconnect.

namespace log_server {

// Start the AsyncServer on port 23. Safe to call before Wi-Fi is up; the
// listener binds when the network stack is ready.
void begin();

// Drive the drain loop. Call from loop(). Cheap when no client is
// connected. AsyncTCP runs writes on its own task; this just nudges the
// drain on a regular cadence so log lines flush within ~50 ms.
void service();

}  // namespace log_server
