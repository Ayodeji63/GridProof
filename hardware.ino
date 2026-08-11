// ─────────────────────────────────────────────────────────────────────────────
// ME371 Dual-Meter Modbus Reader → PowerTech MQTT + GridProof /telemetry
// (ESP32-S3)
//
// SINGLE RS485 bus, multi-dropped: both meters wired to the SAME A/B pair,
// distinguished only by Modbus Slave ID (Meter 1 = ID 1, Meter 2 = ID 2).
// This is standard Modbus RTU multi-drop wiring — no relay, no second
// transceiver, no second UART needed for the METERS. (A relay IS used below
// for a different purpose — see "HARDWARE POWER-CYCLE VIA RELAY" section.)
//
// IMPORTANT — one-time hardware step before wiring both meters together:
// Meter 2 almost certainly ships with the same default slave address as
// Meter 1. Reprogram Meter 2's own address to 2 first (while it's alone on
// a bus), using its Modbus configuration-instruction register (instruction
// code 1210). See chat for a short pymodbus snippet to do this once.
// >>> ALSO CONFIRM the address change was actually committed to Meter 2's
// >>> non-volatile memory. If it wasn't, a brief power dip on that feeder
// >>> can revert Meter 2 back to the factory default address, which then
// >>> collides with Meter 1 and garbles the whole bus for BOTH meters.
// >>> Test: power-cycle Meter 2 alone and re-poll it at address 2.
//
// MQTT credentials below are CONFIRMED WORKING via mosquitto_pub against
// PowerTech's Azure Event Grid MQTT broker (CONNACK 0, PUBLISH sent OK).
//
// ── FIELD-RELIABILITY HARDENING (earlier version) ───────────────────────────
// Added after a field failure mode where the unit ran fine for 8-10 hours,
// then started publishing all-zero telemetry (meters/feeders confirmed fine
// on-site) while WiFi/MQTT kept working — and only a manual restart fixed
// it. That pattern pointed at the RS485/UART side getting stuck:
//   1. Consecutive-total-failure counter → automatic recovery attempt.
//   2. Hardware watchdog (esp_task_wdt) as a hard safety net in case loop()
//      ever truly hangs (e.g. a stuck TLS handshake).
//   3. Free-heap / min-free-heap / PSRAM logging every cycle, so a slow
//      memory leak or fragmentation trend is visible in the log instead of
//      only showing up as a mystery failure hours later.
//   4. buildPayload() rewritten from ~15 chained Arduino String
//      concatenations (many small reallocations every publish, for months
//      of uptime) to a single snprintf into a fixed buffer — removes a
//      whole class of heap-fragmentation risk.
//   5. The TX-echo discard in readRegs() actively waits (bounded) until it
//      has consumed exactly 8 echo bytes, so scheduler/WiFi/TLS jitter
//      can't leave a stray echo byte to be misread as the start of the
//      real response.
//
// ── HARDWARE POWER-CYCLE VIA RELAY (earlier version) ────────────────────────
// Root cause identified in the field: the RS485-to-TTL converter's
// transceiver (auto direction-sensing type, no DE/RE pin) can latch into a
// stuck state after a feeder trip/reclose transient — most likely CMOS
// latch-up or a stuck driver-enable circuit. This explains why the earlier
// UART-reinit / ESP.restart() recovery never actually cleared it: neither
// one removes power from the converter itself, and only a genuine
// power-on-reset can clear a latch-up like this.
//
// A relay (wired NC — normally closed) now sits in series with the
// converter's VCC line, controlled from GPIO 7:
//   - At rest (relay de-energized): NC contact closed, converter powered
//     normally. This is the fail-safe state — if the ESP32 crashes, resets,
//     or a GPIO glitches at boot, the converter stays powered rather than
//     stuck off.
//   - On sustained zero output from BOTH meters (~1 publish cycle, which
//     with PUBLISH_INTERVAL_MS = 60000 is ~1 minute of zero output): the
//     firmware energizes the relay, opening the NC contact and cutting
//     converter power for RELAY_OFF_DURATION_MS, then de-energizes to
//     restore it — a genuine power-cycle of the converter, not just the
//     ESP32's own UART peripheral.
// Capped at MAX_RELAY_CYCLES_BEFORE_PAUSING attempts per outage, both to
// protect the relay's mechanical contacts from excessive cycling and to
// avoid pointlessly toggling power for hours during a genuine extended
// feeder outage — the meters will reconnect on their own once real power is
// back. ESP.restart() is kept as a further fallback if the converter is
// still silent after repeated relay cycles.
//
// ── GRIDPROOF TELEMETRY SINK (this version) ─────────────────────────────────
// Each reading is now delivered to TWO independent sinks, both fed from the
// same buffered TelemetryRecord:
//
//   1. PowerTech MQTT  — unchanged, byte-for-byte the same JSON as before.
//   2. GridProof HTTPS — POST /api/v1/ingest/telemetry, a different schema
//                        with an HMAC-SHA256 signature.
//
// The GridProof body must satisfy `telemetryIngestRequestSchema`
// (packages/shared-types/src/api.ts:87-96):
//
//   deviceId        string, >= 3 chars        ← the meter's DevEUI
//   providerWallet  /^0x[a-fA-F0-9]{40}$/     ← per-meter, compile-time below
//   zoneId          UUID                      ← per-meter, compile-time below
//   idempotencyKey  string, >= 12 chars       ← "<DevEUI>-<unix seconds>"
//   observedAt      ISO-8601 with offset      ← true UTC, ends in "Z"
//   status          grid_up|grid_down|unknown ← derived, see gridproofStatusFor()
//   voltage         number >= 0, optional     ← integer volts, see below
//   signature       hex HMAC-SHA256
//
// Four of those fields do not exist anywhere in the meter's Modbus map —
// providerWallet, zoneId, idempotencyKey and signature are identity and
// transport concerns, not measurements — so they are supplied here.
//
// The signature covers, in this exact order, joined with "." and with an
// EMPTY STRING substituted when voltage is absent (apps/api/src/modules/
// ingestion/routes.ts:237-247):
//
//   deviceId . providerWallet(lowercased) . zoneId . idempotencyKey
//            . observedAt . status . voltage
//
// >>> VOLTAGE IS SENT AS A WHOLE NUMBER, DELIBERATELY. The server rebuilds
// >>> the signing string in JavaScript, where the number goes through
// >>> String(n). A fractional value would have to survive firmware-print →
// >>> JSON → IEEE-754 double → JS shortest-round-trip printing and come back
// >>> character-identical, or every signature fails with a 401 that looks
// >>> like a key problem. Integers make that round-trip exact, and one volt
// >>> of resolution is far below anything the detector reasons about.
//
// >>> THE VOLTAGE REPORTED IS min(V_L12, V_L23, V_L31), not the average.
// >>> On a 3-phase feeder a single lost phase is a real outage for every
// >>> customer on it, and averaging would hide that behind two healthy
// >>> phases. The minimum is the conservative choice.
//
// >>> THESE METERS READ LINE-TO-LINE ON AN 11 kV FEEDER (~10700 V), so a
// >>> healthy reading is ~10700, not ~230. That matters because the API's
// >>> detector (apps/api/src/modules/detection/rules.ts:126-140) scores
// >>> `grid_up` at high confidence only when voltage >= 180 — which 10700
// >>> satisfies — and `grid_down` at high confidence only when voltage <= 5.
// >>> A dead feeder reads at or near 0, so both branches work at this scale
// >>> WITHOUT rescaling. Do not "normalize" these to 230 V: that would put a
// >>> fabricated number on chain, and it is not what the thresholds need.
//
// >>> A SILENT METER IS REPORTED AS `unknown`, NOT `grid_down`. This whole
// >>> file's history (see the relay section above) is a record of the
// >>> converter latching up while the feeder was perfectly fine. Modbus
// >>> silence means "we cannot see", and asserting an outage from it would
// >>> put a converter fault on chain as a provider's downtime. Real
// >>> total-power-loss outages are still caught: when the feeder dies this
// >>> board dies with it and simply stops reporting, which is exactly the
// >>> signal GridProof's heartbeat-gap sweep exists to find.
// ─────────────────────────────────────────────────────────────────────────────

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <PubSubClient.h>
#include <Arduino.h>
#include <time.h>
#include <LittleFS.h>
#include <Preferences.h>
#include <esp_task_wdt.h>
#include "mbedtls/md.h"

// ── WiFi ──────────────────────────────────────────────────────────────────────
#define WIFI_SSID   "POWERTECH_INTEGRIDEX"
#define WIFI_PASS   "Powertech@2025"

unsigned long lastMqttAttempt = 0;
#define MQTT_RECONNECT_INTERVAL_MS 5000UL   // try at most once every 5s

// ── Sink enable flags ──────────────────────────────────────────────────────
// Both default on. A record only leaves the offline queue once every ENABLED
// sink has accepted it, so turning one off also stops it holding the queue.
#define PUBLISH_TO_POWERTECH   true
#define PUBLISH_TO_GRIDPROOF   true

// ── PowerTech MQTT broker — Azure Event Grid Namespace MQTT broker ─────────
// These values are CONFIRMED via mosquitto_pub test (CONNACK 0, PUBLISH sent):
//   mosquitto_pub --cafile ca.pem --cert powertech_clientId_1.pem
//     --key powertech-client.key -h <host> -p 8883 -i "NGR-ESP-011"
//     -u "powertech_clientId_11" -P "" -t "powertechfeeder/messagetopic" -m '...'
#define MQTT_BROKER_HOST   "powertechmqtt.northeurope-1.ts.eventgrid.azure.net"
#define MQTT_BROKER_PORT   8883
#define MQTT_CLIENT_ID     "NGR-ESP-011"           // confirmed via mosquitto_pub -i
#define MQTT_USERNAME      "powertech_clientId_11" // confirmed via mosquitto_pub -u
#define MQTT_PASSWORD      ""                      // confirmed empty — cert-based auth
#define MQTT_TOPIC         "powertechfeeder/messagetopic" // confirmed via mosquitto_pub -t
#define PROVIDER_SOURCE    "NERC"                  // TODO: confirm with PowerTech — their
                                                    // own spec shows "NERC" in the main
                                                    // example but "provider1" in the field
                                                    // description table (inconsistent doc)

// Set true ONLY for initial bring-up/testing if you don't yet have the
// broker's root CA cert loaded. Insecure — must be false before production.
#define MQTT_TLS_INSECURE_TESTING_ONLY  false

// ── GridProof ingestion API ────────────────────────────────────────────────
// Router is mounted at /api/v1/ingest (apps/api/src/app.ts:32); the handler is
// POST /telemetry (apps/api/src/modules/ingestion/routes.ts:28).
//
// >>> THE API MUST RUN WITH GRIDPROOF_EVIDENCE_MODE UNSET, "sensor", OR
// >>> "hybrid". Under GRIDPROOF_EVIDENCE_MODE=reporter this endpoint returns
// >>> 403 EVIDENCE_SOURCE_DISABLED for every post (routes.ts:109).
// ── GridProof — signing string order must match routes.ts:237-245 exactly ────
//   deviceId . providerWallet(lowercased) . zoneId . idempotencyKey
//            . observedAt . status . voltage(empty when absent)
// An absent voltage is the EMPTY STRING — the trailing dot stays.
// createHmac on the server returns lowercase hex; we send lowercase too.
#define GRIDPROOF_API_HOST     "api.gridproof.example"   // TODO: real host
#define GRIDPROOF_API_PORT     443
#define GRIDPROOF_API_PATH     "/api/v1/ingest/telemetry"
#define GRIDPROOF_HTTP_TIMEOUT_MS  10000

// Must equal TELEMETRY_HMAC_SECRET in the API's environment.
//
// >>> IF THE API HAS NO SECRET SET AND IS NOT RUNNING WITH
// >>> NODE_ENV=production, IT SKIPS THE SIGNATURE CHECK ENTIRELY
// >>> (routes.ts:44). A successful bring-up against a dev API therefore
// >>> proves nothing about this value — it is only ever exercised once the
// >>> secret is actually configured on the server.
#define GRIDPROOF_HMAC_SECRET  "REPLACE_WITH_TELEMETRY_HMAC_SECRET"

// Set true ONLY for bring-up against a self-signed/staging cert.
#define GRIDPROOF_TLS_INSECURE_TESTING_ONLY  true

// Paste the API server cert's issuing root here, then set the flag above false.
const char* GRIDPROOF_CA_CERT = R"EOF(
-----BEGIN CERTIFICATE-----
REPLACE_WITH_GRIDPROOF_API_ROOT_CA
-----END CERTIFICATE-----
)EOF";

// Per-meter GridProof identity. Index matches DEV_EUI / meterIndex below.
//
// >>> providerWallet: the address that staked in ReputationEscrow for this
// >>> meter. Whatever is sent here gets an ACTIVE `providers` row created for
// >>> it on first contact (apps/api/src/modules/ingestion/store.ts:294) — a
// >>> typo does not error, it silently registers a new provider.
//
// >>> zoneId: the UUID primary key of the `zones` row for this feeder, NOT
// >>> the on-chain bytes32 zone key. Same warning, worse consequence: an
// >>> unknown UUID is auto-inserted as a placeholder zone named
// >>> "Zone <first 8 chars>" with a "DEMO-" feeder code (store.ts:275-292).
// >>> Nothing rejects it and nothing flags it later — evidence just
// >>> accumulates against a phantom zone with no on-chain allowlist entry.
// >>> Copy both values out of the database; do not invent them.
const char* GRIDPROOF_PROVIDER_WALLET[2] = {
  "0x0000000000000000000000000000000000000000",   // TODO: Meter 1 provider wallet
  "0x0000000000000000000000000000000000000000"    // TODO: Meter 2 provider wallet
};

const char* GRIDPROOF_ZONE_ID[2] = {
  "00000000-0000-0000-0000-000000000000",         // TODO: Meter 1 zone UUID
  "00000000-0000-0000-0000-000000000000"          // TODO: Meter 2 zone UUID
};

// At or below this, a reading counts as grid_down. Chosen to line up exactly
// with the API's own high-confidence branch: rules.ts:135 awards 0.95
// confidence only when `voltage <= 5`. Raising this number without also
// changing that rule produces grid_down events that fall back to the generic
// 0.72 default instead.
#define GRIDPROOF_DOWN_VOLTAGE_V   5

// The API rejects observedAt older than INGEST_MAX_EVENT_AGE_MS, default 24h
// (routes.ts:22, :154). A buffered record that ages past that can never be
// accepted, so GridProof delivery is abandoned for it rather than retried
// forever — otherwise one stale record at the head of the queue would block
// every fresher reading behind it, permanently. Set below 24h for margin.
#define GRIDPROOF_MAX_RECORD_AGE_S  (23UL * 3600UL)

// Clock sanity floor. Before NTP syncs, time() returns values near epoch 0.
// Those would be signed and buffered as if valid, then rejected on arrival.
// 2023-11-14T22:13:20Z.
#define MIN_PLAUSIBLE_EPOCH  1700000000UL

// Paste the EXACT content of ca.pem here (the file that worked with mosquitto_pub --cafile).
// Run: cat ca.pem
const char* MQTT_CA_CERT = R"EOF(
-----BEGIN CERTIFICATE-----
MIICPzCCAcWgAwIBAgIQBVVWvPJepDU1w6QP1atFcjAKBggqhkjOPQQDAzBhMQsw
CQYDVQQGEwJVUzEVMBMGA1UEChMMRGlnaUNlcnQgSW5jMRkwFwYDVQQLExB3d3cu
ZGlnaWNlcnQuY29tMSAwHgYDVQQDExdEaWdpQ2VydCBHbG9iYWwgUm9vdCBHMzAe
Fw0xMzA4MDExMjAwMDBaFw0zODAxMTUxMjAwMDBaMGExCzAJBgNVBAYTAlVTMRUw
EwYDVQQKEwxEaWdpQ2VydCBJbmMxGTAXBgNVBAsTEHd3dy5kaWdpY2VydC5jb20x
IDAeBgNVBAMTF0RpZ2lDZXJ0IEdsb2JhbCBSb290IEczMHYwEAYHKoZIzj0CAQYF
K4EEACIDYgAE3afZu4q4C/sLfyHS8L6+c/MzXRq8NOrexpu80JX28MzQC7phW1FG
fp4tn+6OYwwX7Adw9c+ELkCDnOg/QW07rdOkFFk2eJ0DQ+4QE2xy3q6Ip6FrtUPO
Z9wj/wMco+I+o0IwQDAPBgNVHRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwIBhjAd
BgNVHQ4EFgQUs9tIpPmhxdiuNkHMEWNpYim8S8YwCgYIKoZIzj0EAwMDaAAwZQIx
AK288mw/EkrRLTnDCgmXc/SINoyIJ7vmiI1Qhadj+Z4y3maTD/HMsQmP3Wyr+mt/
oAIwOWZbwmSNuJ5Q3KjVSaLtx9zRSX8XAbjIho9OjIgrqJqpisXRAL34VOKa5Vt8
sycX
-----END CERTIFICATE-----
)EOF";

// Paste the EXACT content of powertech_clientId_1.pem here.
// Run: cat powertech_clientId_1.pem
const char* MQTT_CLIENT_CERT = R"EOF(
-----BEGIN CERTIFICATE-----
MIIB+DCCAZ6gAwIBAgIRAKjnOR0gaKzsZs5s1hOoRGgwCgYIKoZIzj0EAwIwRjEZ
MBcGA1UEChMQTXF0dEFwcFNhbXBsZXNDQTEpMCcGA1UEAxMgTXF0dEFwcFNhbXBs
ZXNDQSBJbnRlcm1lZGlhdGUgQ0EwHhcNMjUxMTE4MTgxODAyWhcNMzAxMTE3MTgx
NzQ2WjAfMR0wGwYDVQQDDBRwb3dlcnRlY2hfY2xpZW50SWRfMTBZMBMGByqGSM49
AgEGCCqGSM49AwEHA0IABIbSZ2HJM5okxVWadyIIptV2wwyiZcrY9bOCQVfD+2e5
6mGteeXY+iWqYu5JQ7CVm+ePNE/Rj8z1nU8/PLHeI++jgZMwgZAwDgYDVR0PAQH/
BAQDAgeAMB0GA1UdJQQWMBQGCCsGAQUFBwMBBggrBgEFBQcDAjAdBgNVHQ4EFgQU
SIqu9f9jXStRVoOrOT97MZY3goowHwYDVR0jBBgwFoAU0f/cGJeNjc0UE0I+RQUt
ILSU/yswHwYDVR0RBBgwFoIUcG93ZXJ0ZWNoX2NsaWVudElkXzEwCgYIKoZIzj0E
AwIDSAAwRQIgbyc/iWDiBIwFZ5GQimWPhw9rPCSzOGm98mpN068rDUYCIQDH3Afv
IgvbEbcC1ZvfiijMX8NYPzlo9lglerRQDNiraA==
-----END CERTIFICATE-----
)EOF";

// Paste the EXACT content of powertech-client.key here — keep whatever header
// the file actually has (PRIVATE KEY / RSA PRIVATE KEY / EC PRIVATE KEY).
// Run: cat powertech-client.key
const char* MQTT_CLIENT_KEY = R"EOF(
-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgabPwB3u9DvwlL8XH
H8UeiVXguAdONH56iV3goO5KrqehRANCAASG0mdhyTOaJMVVmnciCKbVdsMMomXK
2PWzgkFXw/tnuephrXnl2PolqmLuSUOwlZvnjzRP0Y/M9Z1PPzyx3iPv
-----END PRIVATE KEY-----
)EOF";

// ── NTP — PowerTech requires true GMT timestamps, not GMT+1 ─────────────────
// GridProof needs the same thing for a different reason: its observedAt must
// parse as ISO-8601 with an offset, and be inside the ingestion window.
#define NTP_SERVER  "pool.ntp.org"
#define GMT_OFFSET  0
#define DST_OFFSET  0

// ── Publish cadence (PowerTech default: 1 message per minute) ──────────────
// Also comfortably inside GridProof's rate limit, which is keyed per deviceId
// at 60 requests/minute by default (routes.ts:31, middleware/rate-limit.ts:7).
#define PUBLISH_INTERVAL_MS  60000UL

// ── RS485 / Modbus — ONE shared bus, TWO meters multi-dropped ─────────────
// Wiring: Meter1 A/B and Meter2 A/B connect in parallel to this single pair
// (daisy-chained), with a 120 Ω termination resistor at each physical end
// of the line, and a common ground/shield running the full length.
HardwareSerial RS485(1);   // UART1 — shared by both meters

#define RX_PIN   10
#define TX_PIN   13
#define BAUD     38400

#define SLAVE_ID_1  1     // Meter 1's configured Modbus address
#define SLAVE_ID_2  2     // Meter 2's configured Modbus address
                          // NOTE: Meter 2 must be reprogrammed to address 2
                          // BEFORE being wired onto the shared bus — see the
                          // one-time pymodbus snippet in chat.

// ── Offline buffer config (unchanged ring-buffer design) ─────────────────────
#define QUEUE_FILE      "/queue.bin"
#define QUEUE_TMP_FILE  "/queue.tmp"
#define MAX_QUEUE_BYTES (9UL * 1024UL * 1024UL)   // ~9MB of ~9.9MB LittleFS partition
#define MAX_FLUSH_PER_LOOP 5                       // don't block the loop too long

// ── RS485 hardware power-cycle relay ──────────────────────────────────────
// This relay sits in series with the RS485-TTL converter's VCC line, wired
// through its NC (normally-closed) contact so the converter is powered by
// default and stays powered through any ESP32 crash/brownout/reset — the
// relay only cuts power when the firmware deliberately energizes it.
#define RELAY_PIN              7
#define RELAY_ACTIVE_HIGH      true      // set false if your relay module energizes on GPIO LOW instead —
                                          // verify with a multimeter/continuity test on the bench before
                                          // trusting this in the field
#define RELAY_OFF_DURATION_MS  60000UL   // how long to hold the converter powered OFF before restoring.
                                          // NOTE: a genuine power-on-reset only needs a few hundred ms of
                                          // true zero volts to clear a latch-up — 60s here is a deliberate,
                                          // generous margin per spec, not an electrical requirement. Shorten
                                          // it later (e.g. to 1000UL) once you've confirmed this actually
                                          // clears the fault, if you want faster recovery per event.

// Trigger: both meters reading zero for this many consecutive publish
// cycles. PUBLISH_INTERVAL_MS is 60000 (1 minute), so a value of 1 here
// means "cut power after ~1 minute of total silence from both meters."
#define FULL_FAILURE_CYCLES_BEFORE_RELAY_CYCLE   1
#define FULL_FAILURE_CYCLES_BEFORE_REBOOT        6   // give the relay several tries before a full MCU reboot
#define MAX_RELAY_CYCLES_BEFORE_PAUSING          3   // stop actively power-cycling after this many attempts in
                                                       // one outage — protects the relay's mechanical contacts
                                                       // and avoids pointlessly toggling power for hours during
                                                       // a genuine extended feeder outage (the meters reconnect
                                                       // on their own once real power is back; we just keep
                                                       // monitoring and let ESP.restart() be the final fallback)
uint32_t consecutiveFullFailures  = 0;
uint32_t relayCycleAttempts       = 0;
uint32_t lastRelayCycleAt         = 0;   // millis() of the last relay power-cycle (0 = never)

// Hardware watchdog — hard safety net in case loop() ever truly hangs
// (e.g. a stuck TLS handshake) rather than just failing gracefully.
// NOTE: esp_task_wdt's API changed between arduino-esp32 core 2.x and 3.x.
// This uses the older/simpler init call, which is still the most widely
// deployed. If your installed core is 3.x and this doesn't compile, swap
// in esp_task_wdt_config_t + esp_task_wdt_reconfigure() per its docs.
//
// >>> RAISED FROM 60s TO 150s WHEN THE GRIDPROOF SINK WAS ADDED. One loop pass
// >>> now does considerably more blocking work than it used to: up to
// >>> MAX_FLUSH_PER_LOOP queued records, then two live meters, each of which
// >>> can spend up to GRIDPROOF_HTTP_TIMEOUT_MS on connect plus the same again
// >>> on read inside a single TLS POST. At the old 60s the watchdog would have
// >>> fired during a normal-but-slow network pass and rebooted a perfectly
// >>> healthy board — turning a slow uplink into a boot loop. esp_task_wdt_reset()
// >>> is called per flushed record and around each meter so the feed interval
// >>> stays well inside this, but the ceiling needs the headroom regardless.
#define HW_WATCHDOG_TIMEOUT_S  150

Preferences prefs;
WiFiClientSecure tlsClient;
PubSubClient mqttClient(tlsClient);

// Separate TLS client for the GridProof POST. It cannot share tlsClient —
// PubSubClient holds that one open for the MQTT session's whole lifetime.
// This one connects and tears down per request, so its handshake arena is
// only held during the POST. Watch the heap line in the status summary if
// you ever see connect failures that clear up on their own.
WiFiClientSecure apiTlsClient;

// Per-meter DevEUI expected by PowerTech's payload. Doubles as GridProof's
// `deviceId` and as the prefix of its `idempotencyKey`.
const char* DEV_EUI[2] = {
  "a84041ed485a0b9f",   // Meter 1
  "a84041911d5a0b87"    // Meter 2
};

// Packed so every record is a fixed, predictable size on flash.
//
// Deliberately UNCHANGED from the pre-GridProof firmware: every field the
// GridProof payload needs (deviceId, zoneId, wallet, idempotency key, status,
// voltage) is derived from `meterIndex`, `timestamp`, `online` and the three
// line voltages already stored here. Keeping the layout byte-identical means
// readings buffered by the previous firmware survive this upgrade instead of
// being reinterpreted as garbage on the first boot after flashing.
struct __attribute__((packed)) TelemetryRecord {
  uint32_t timestamp;          // unix epoch seconds (true UTC)
  uint8_t  meterIndex;         // 0 = Meter 1, 1 = Meter 2
  uint8_t  online;             // 1 = meter responded, 0 = offline
  float    I_L1, I_L2, I_L3;           // A_L1 / A_L2 / A_L3
  float    V_L12, V_L23, V_L31;        // V_L12 / V_L23 / V_L31
  float    activePowerInst;            // Active_Power_Inst   (kW)
  float    reactivePowerInst;          // Reactive_Power_Inst (kVAr)
  float    apparentPowerInst;          // Apparent_Power_Inst (kVA)
  float    powerFactorAvg;             // Power_Factor_Avg
  float    freqAvg;                    // Frequency_Avg (Hz)
  uint32_t activeEnergyTot;            // Active_energy_Tot   (kWh)
  uint32_t reactiveEnergyTot;          // Reactive_energy_Tot (kVARh)
  uint32_t apparentEnergyTot;          // ApparentEnergyTotal (kVAh)
};

// ── Diagnostics / running counters ──────────────────────────────────────────
// Updated every cycle, printed in the STATUS SUMMARY block so you can see at
// a glance whether Modbus reads, MQTT publishes and GridProof posts are
// actually succeeding, and how long it's been since each last worked.
uint32_t stat_modbusAttempts[2] = {0, 0};   // per-meter read cycles attempted
uint32_t stat_modbusSuccess[2]  = {0, 0};   // per-meter read cycles with >=1 good register group
uint32_t stat_mqttAttempts      = 0;
uint32_t stat_mqttSuccess       = 0;
uint32_t stat_gpAttempts        = 0;
uint32_t stat_gpSuccess         = 0;
uint32_t stat_gpDuplicates      = 0;   // API answered 200 — it already had this idempotencyKey
uint32_t stat_gpRejected        = 0;   // 4xx other than 429 — permanent, record abandoned
uint32_t stat_gpExpired         = 0;   // aged past the ingestion window before delivery
uint32_t lastModbusOkAt[2]      = {0, 0};   // millis() of last successful read per meter (0 = never)
uint32_t lastMqttOkAt           = 0;        // millis() of last successful publish (0 = never)
uint32_t lastGpOkAt             = 0;        // millis() of last successful POST (0 = never)
int      lastGpHttpCode         = 0;        // last HTTP status (or negative HTTPClient error)

// ── Modbus helpers ────────────────────────────────────────────────────────────
uint16_t modbusCRC(uint8_t *buf, uint8_t len) {
  uint16_t crc = 0xFFFF;
  for (uint8_t i = 0; i < len; i++) {
    crc ^= buf[i];
    for (uint8_t j = 0; j < 8; j++)
      crc = (crc & 0x0001) ? (crc >> 1) ^ 0xA001 : (crc >> 1);
  }
  return crc;
}

// Prints raw bytes as hex — used when a Modbus read fails, so you can tell
// "meter said nothing" apart from "meter answered but bytes are garbled"
// (which points at the RS485 adapter or wiring/termination, not the meter).
void hexDump(const char* label, uint8_t *buf, uint8_t len) {
  Serial.printf("      %s (%u bytes): ", label, len);
  if (len == 0) {
    Serial.println("<empty>");
    return;
  }
  for (uint8_t i = 0; i < len; i++) Serial.printf("%02X ", buf[i]);
  Serial.println();
}

int readRegs(HardwareSerial &port, uint8_t slaveID,
             uint16_t addr, uint8_t count, uint16_t *out) {
  uint8_t req[8];
  req[0] = slaveID; req[1] = 0x03;
  req[2] = addr >> 8; req[3] = addr & 0xFF;
  req[4] = 0x00;      req[5] = count;
  uint16_t crc = modbusCRC(req, 6);
  req[6] = crc & 0xFF; req[7] = crc >> 8;

  while (port.available()) port.read();   // flush stale bytes
  port.write(req, 8);
  port.flush();

  // ── TX-echo discard (hardened) ───────────────────────────────────────────
  // Actively waits (bounded to 50ms — generous for 8 bytes at 38400 baud,
  // which take ~2ms on the wire) until it has actually consumed 8 echo
  // bytes, regardless of exactly when they arrive, so scheduler/WiFi/TLS
  // jitter can't leave a stray echo byte to be misread as the start of the
  // real response.
delay(10);                              // discard TX echo
uint8_t echo = 0;
while (port.available() && echo < 8) { port.read(); echo++; }

  uint8_t expectLen = 5 + count * 2;
  uint8_t buf[64]; uint8_t rxLen = 0;
  unsigned long t = millis();
  while (rxLen < expectLen && millis() - t < 500)
    if (port.available()) buf[rxLen++] = port.read();

  // Nothing came back at all — meter offline, wrong slave ID, or the bus/
  // adapter isn't delivering bytes. This is the "silent" failure mode.
  if (rxLen == 0) {
    Serial.printf("      [reg 0x%04X, slave %d] NO RESPONSE (0 bytes in 500ms) — meter offline, wrong slave ID, or adapter/wiring not passing data\n", addr, slaveID);
    return -1;
  }

  // Modbus exception reply: function code echoed back with the 0x80 bit set.
  if (rxLen >= 3 && buf[1] == (0x03 | 0x80)) {
    Serial.printf("      [reg 0x%04X, slave %d] MODBUS EXCEPTION — code 0x%02X\n", addr, slaveID, buf[2]);
    hexDump("raw rx", buf, rxLen);
    return -3;
  }

  // Got *some* bytes but not the full expected frame — the meter is talking,
  // but the adapter/USB link is dropping or corrupting bytes mid-frame.
  if (rxLen < expectLen) {
    Serial.printf("      [reg 0x%04X, slave %d] SHORT/PARTIAL RESPONSE — got %u bytes, expected %u (points at adapter/USB link, not the meter)\n", addr, slaveID, rxLen, expectLen);
    hexDump("raw rx", buf, rxLen);
    return -1;
  }

  uint16_t calcCRC = modbusCRC(buf, rxLen - 2);
  uint16_t rxCRC   = buf[rxLen-2] | ((uint16_t)buf[rxLen-1] << 8);
  if (calcCRC != rxCRC) {
    Serial.printf("      [reg 0x%04X, slave %d] CRC MISMATCH (calc=%04X rx=%04X) — noisy line, missing/bad termination, or bit errors\n", addr, slaveID, calcCRC, rxCRC);
    hexDump("raw rx", buf, rxLen);
    return -2;
  }

  for (uint8_t i = 0; i < count; i++)
    out[i] = ((uint16_t)buf[3 + i*2] << 8) | buf[4 + i*2];

  return count;
}

float toFloat(uint16_t hi, uint16_t lo) {
  uint32_t raw = ((uint32_t)hi << 16) | lo;
  float f; memcpy(&f, &raw, 4);
  return f;
}

// Energy totals are Modbus type UInt32 (not Float32) — combine directly.
uint32_t toUInt32(uint16_t hi, uint16_t lo) {
  return ((uint32_t)hi << 16) | lo;
}

// Reads exactly the registers PowerTech's payload needs:
//   1000  I1,I2,I3           (A_L1/A_L2/A_L3)
//   1020  U12,U23,U31        (V_L12/V_L23/V_L31 — line-to-line)
//   1028  P1,P2,P3,PTotal    → Active_Power_Inst
//   1036  Q1,Q2,Q3,QTotal    → Reactive_Power_Inst
//   1044  S1,S2,S3,STotal    → Apparent_Power_Inst
//   1052  PF1,PF2,PF3,PFTotal→ Power_Factor_Avg
//   1074  FreqTotal          → Frequency_Avg
//   2606  EPImp (kWh)        → Active_energy_Tot
//   2622  EQImp (kVARh)      → Reactive_energy_Tot
//   2638  ES    (kVAh)       → ApparentEnergyTotal
//
// The 1020 group is the one GridProof depends on: its `status` and `voltage`
// are derived from those three line-to-line readings and nothing else.
//
// meterIndex (0 or 1) is used purely to update the right diagnostic counters.
bool readMeter(HardwareSerial &port, uint8_t slaveID, uint8_t meterIndex, const char* label,
               float &I_L1, float &I_L2, float &I_L3,
               float &V_L12, float &V_L23, float &V_L31,
               float &activePowerInst, float &reactivePowerInst, float &apparentPowerInst,
               float &powerFactorAvg, float &freqAvg,
               uint32_t &activeEnergyTot, uint32_t &reactiveEnergyTot, uint32_t &apparentEnergyTot) {

  uint16_t regs[8]; int r;
  int successCount = 0;
  const int totalGroups = 10;
  Serial.printf("\n── Reading %s (Slave %d) ──\n", label, slaveID);

  r = readRegs(port, slaveID, 1000, 6, regs);
  if (r > 0) {
    I_L1 = toFloat(regs[0], regs[1]);
    I_L2 = toFloat(regs[2], regs[3]);
    I_L3 = toFloat(regs[4], regs[5]);
    Serial.printf("   OK  A_L1=%.3fA  A_L2=%.3fA  A_L3=%.3fA\n", I_L1, I_L2, I_L3);
    successCount++;
  }

  r = readRegs(port, slaveID, 1020, 6, regs);
  if (r > 0) {
    V_L12 = toFloat(regs[0], regs[1]);
    V_L23 = toFloat(regs[2], regs[3]);
    V_L31 = toFloat(regs[4], regs[5]);
    Serial.printf("   OK  V_L12=%.2fV  V_L23=%.2fV  V_L31=%.2fV\n", V_L12, V_L23, V_L31);
    successCount++;
  }

  r = readRegs(port, slaveID, 1028, 8, regs);
  if (r > 0) { activePowerInst = toFloat(regs[6], regs[7]); Serial.printf("   OK  Active_Power_Inst=%.3fkW\n", activePowerInst); successCount++; }

  r = readRegs(port, slaveID, 1036, 8, regs);
  if (r > 0) { reactivePowerInst = toFloat(regs[6], regs[7]); Serial.printf("   OK  Reactive_Power_Inst=%.3fkVAr\n", reactivePowerInst); successCount++; }

  r = readRegs(port, slaveID, 1044, 8, regs);
  if (r > 0) { apparentPowerInst = toFloat(regs[6], regs[7]); Serial.printf("   OK  Apparent_Power_Inst=%.3fkVA\n", apparentPowerInst); successCount++; }

  r = readRegs(port, slaveID, 1052, 8, regs);
  if (r > 0) { powerFactorAvg = toFloat(regs[6], regs[7]); Serial.printf("   OK  Power_Factor_Avg=%.4f\n", powerFactorAvg); successCount++; }

  r = readRegs(port, slaveID, 1074, 2, regs);
  if (r > 0) { freqAvg = toFloat(regs[0], regs[1]); Serial.printf("   OK  Frequency_Avg=%.3fHz\n", freqAvg); successCount++; }

  r = readRegs(port, slaveID, 2606, 2, regs);
  if (r > 0) { activeEnergyTot = toUInt32(regs[0], regs[1]); Serial.printf("   OK  Active_energy_Tot=%u kWh\n", activeEnergyTot); successCount++; }

  r = readRegs(port, slaveID, 2622, 2, regs);
  if (r > 0) { reactiveEnergyTot = toUInt32(regs[0], regs[1]); Serial.printf("   OK  Reactive_energy_Tot=%u kVARh\n", reactiveEnergyTot); successCount++; }

  r = readRegs(port, slaveID, 2638, 2, regs);
  if (r > 0) { apparentEnergyTot = toUInt32(regs[0], regs[1]); Serial.printf("   OK  ApparentEnergyTotal=%u kVAh\n", apparentEnergyTot); successCount++; }

  bool anyOk = successCount > 0;
  const char* verdict = (successCount == totalGroups) ? "ALL GOOD"
                       : (successCount == 0)           ? "METER OFFLINE"
                                                        : "PARTIAL — check wiring/adapter";
  Serial.printf("── %s summary: %d/%d register groups OK  [%s] ──\n", label, successCount, totalGroups, verdict);

  stat_modbusAttempts[meterIndex]++;
  if (anyOk) {
    stat_modbusSuccess[meterIndex]++;
    lastModbusOkAt[meterIndex] = millis();
  }

  return anyOk;   // false only if the meter answered NOTHING
}

// ── Relay control — power-cycles the RS485-TTL converter itself ───────────
// This is deliberately separate from anything meter-related: it doesn't
// touch the meters, it only cuts and restores power to the converter board
// sitting between the ESP32 and the shared A/B bus.
void setRelay(bool energized) {
  // energized=true  -> relay coil ON  -> COM switches to NO -> NC path OPENS -> converter power CUT
  // energized=false -> relay coil OFF (rest state) -> COM stays on NC -> converter POWERED (fail-safe default)
  bool pinHigh = RELAY_ACTIVE_HIGH ? energized : !energized;
  digitalWrite(RELAY_PIN, pinHigh ? HIGH : LOW);
}

void powerCycleRS485Converter() {
  relayCycleAttempts++;
  lastRelayCycleAt = millis();
  Serial.printf("⚠ Power-cycling RS485 converter via relay (attempt %u/%u) — suspected transceiver latch-up after sustained zero output\n",
                relayCycleAttempts, MAX_RELAY_CYCLES_BEFORE_PAUSING);

  setRelay(true);   // energize relay -> NC opens -> converter power CUT
  unsigned long start = millis();
  while (millis() - start < RELAY_OFF_DURATION_MS) {
    esp_task_wdt_reset();   // keep the hardware watchdog fed during this long wait
    mqttClient.loop();      // harmless no-op if MQTT isn't connected; services keepalive if it still is
    delay(100);
  }
  setRelay(false);  // de-energize -> NC closes -> converter power RESTORED

  Serial.println("✓ RS485 converter power restored — reinitializing UART");
  delay(300);   // let the converter's own regulator/POR settle before we talk to it again
  RS485.end();
  RS485.begin(BAUD, SERIAL_8N1, RX_PIN, TX_PIN);
}

// ── WiFi connect ──────────────────────────────────────────────────────────────
void connectWiFi() {
  Serial.printf("Connecting to %s", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) {
    delay(500); Serial.print(".");
  }
  if (WiFi.status() == WL_CONNECTED)
    Serial.printf("\nConnected — IP: %s  RSSI: %d dBm\n", WiFi.localIP().toString().c_str(), WiFi.RSSI());
  else
    Serial.println("\nWiFi connect timed out — will retry later");
}

// True-UTC ISO8601 string, e.g. "2026-07-07T12:00:00Z".
// Satisfies PowerTech's spec and GridProof's
// z.string().datetime({ offset: true }) alike.
String makeTimestamp(uint32_t epoch) {
  time_t t = (time_t)epoch;
  struct tm timeinfo;
  gmtime_r(&t, &timeinfo);
  char buf[25];
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &timeinfo);
  return String(buf);
}

// ── Offline queue (LittleFS ring buffer) — unchanged design ──────────────────
size_t queueUsedBytes() {
  File f = LittleFS.open(QUEUE_FILE, "r");
  size_t total = f ? f.size() : 0;
  if (f) f.close();
  size_t offset = prefs.getULong("qOffset", 0);
  return (total > offset) ? (total - offset) : 0;
}

uint32_t queueRecordCount() {
  return queueUsedBytes() / sizeof(TelemetryRecord);
}

void compactQueueIfNeeded() {
  size_t offset = prefs.getULong("qOffset", 0);
  if (offset == 0) return;

  File f = LittleFS.open(QUEUE_FILE, "r");
  if (!f) return;
  size_t total = f.size();

  if (offset >= total) {
    f.close();
    LittleFS.remove(QUEUE_FILE);
    prefs.putULong("qOffset", 0);
    return;
  }

  if (offset > total / 2) {
    File tmp = LittleFS.open(QUEUE_TMP_FILE, "w");
    f.seek(offset);
    uint8_t buf[512];
    while (f.available()) {
      size_t n = f.read(buf, sizeof(buf));
      tmp.write(buf, n);
    }
    tmp.close();
    f.close();
    LittleFS.remove(QUEUE_FILE);
    LittleFS.rename(QUEUE_TMP_FILE, QUEUE_FILE);
    prefs.putULong("qOffset", 0);
    return;
  }
  f.close();
}

bool enqueueRecord(const TelemetryRecord &rec) {
  int guard = 0;
  while (queueUsedBytes() + sizeof(rec) > MAX_QUEUE_BYTES && guard++ < 100000) {
    size_t offset = prefs.getULong("qOffset", 0);
    prefs.putULong("qOffset", offset + sizeof(TelemetryRecord));
  }

  File f = LittleFS.open(QUEUE_FILE, "a");
  if (!f) return false;
  size_t written = f.write((const uint8_t*)&rec, sizeof(rec));
  f.close();
  compactQueueIfNeeded();
  return written == sizeof(rec);
}

bool dequeuePeekRecord(TelemetryRecord &rec) {
  size_t offset = prefs.getULong("qOffset", 0);
  File f = LittleFS.open(QUEUE_FILE, "r");
  if (!f) return false;
  if (offset + sizeof(rec) > f.size()) { f.close(); return false; }
  f.seek(offset);
  size_t n = f.read((uint8_t*)&rec, sizeof(rec));
  f.close();
  return n == sizeof(rec);
}

void dequeueAdvance() {
  size_t offset = prefs.getULong("qOffset", 0);
  prefs.putULong("qOffset", offset + sizeof(TelemetryRecord));
  compactQueueIfNeeded();
}

// ── Build the JSON payload exactly as PowerTech's guide specifies ───────────
// Optional fields (data.EXTI_Trigger, data.Payver, data.timestamp, fcnt,
// fport) are omitted per the spec's own note that they're not required —
// fcnt/fport are LoRaWAN-specific and don't apply to a WiFi/MQTT device.
String buildPayload(const TelemetryRecord &rec) {
  bool offline = (rec.online == 0);
  String ts = makeTimestamp(rec.timestamp);   // true UTC, e.g. 2026-07-10T12:00:00Z

  char buf[600];
  int n = snprintf(buf, sizeof(buf),
    "{\"DevEUI\":\"%s\",\"data\":{"
    "\"A_L1\":%.3f,\"A_L2\":%.3f,\"A_L3\":%.3f,"
    "\"V_L12\":%.2f,\"V_L23\":%.2f,\"V_L31\":%.2f,"
    "\"Power_Factor_Avg\":%.4f,\"Frequency_Avg\":%.3f,"
    "\"Reactive_Power_Inst\":%.3f,\"Active_Power_Inst\":%.3f,\"Apparent_Power_Inst\":%.3f,"
    "\"Active_energy_Tot\":%u,\"Reactive_energy_Tot\":%u,\"ApparentEnergyTotal\":%u,"
    "\"Status\":%d},"
    "\"time\":\"%s\",\"provider_source\":\"%s\",\"ofln\":\"%s\"}",
    DEV_EUI[rec.meterIndex],
    (double)(offline ? 0.0f : rec.I_L1), (double)(offline ? 0.0f : rec.I_L2), (double)(offline ? 0.0f : rec.I_L3),
    (double)(offline ? 0.0f : rec.V_L12), (double)(offline ? 0.0f : rec.V_L23), (double)(offline ? 0.0f : rec.V_L31),
    (double)(offline ? 0.0f : rec.powerFactorAvg), (double)(offline ? 0.0f : rec.freqAvg),
    (double)(offline ? 0.0f : rec.reactivePowerInst), (double)(offline ? 0.0f : rec.activePowerInst), (double)(offline ? 0.0f : rec.apparentPowerInst),
    (unsigned)(offline ? 0 : rec.activeEnergyTot), (unsigned)(offline ? 0 : rec.reactiveEnergyTot), (unsigned)(offline ? 0 : rec.apparentEnergyTot),
    offline ? 0 : 1,
    ts.c_str(), PROVIDER_SOURCE, offline ? "1" : "0"
  );

  if (n < 0 || n >= (int)sizeof(buf)) {
    Serial.println("⚠ buildPayload: snprintf truncated or failed — payload buffer may need to be larger");
  }
  return String(buf);
}

// ═════════════════════════════════════════════════════════════════════════════
// GridProof sink
// ═════════════════════════════════════════════════════════════════════════════

// HMAC-SHA256 → lowercase hex, using the mbedTLS already linked into the
// ESP32 core (no extra library). `out` must have room for 65 bytes.
void hmacSha256Hex(const char* key, const char* msg, size_t msgLen, char out[65]) {
  uint8_t mac[32];
  mbedtls_md_context_t ctx;
  mbedtls_md_init(&ctx);
  const mbedtls_md_info_t* info = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  mbedtls_md_setup(&ctx, info, 1);   // 1 = HMAC mode
  mbedtls_md_hmac_starts(&ctx, (const uint8_t*)key, strlen(key));
  mbedtls_md_hmac_update(&ctx, (const uint8_t*)msg, msgLen);
  mbedtls_md_hmac_finish(&ctx, mac);
  mbedtls_md_free(&ctx);

  // Lowercase hex: the server lowercases the received signature before
  // comparing (routes.ts:248), and compares hex-decoded bytes, so case would
  // not actually matter — but matching its own output format keeps the two
  // sides trivially diffable when a signature does go wrong.
  static const char hex[] = "0123456789abcdef";
  for (int i = 0; i < 32; i++) {
    out[i * 2]     = hex[mac[i] >> 4];
    out[i * 2 + 1] = hex[mac[i] & 0x0F];
  }
  out[64] = '\0';
}

// The server lowercases providerWallet before signing (routes.ts:239). A
// checksummed (mixed-case) address in the config above would otherwise sign
// differently here and fail with a 401 that looks nothing like its cause.
void copyLowered(const char* src, char* dst, size_t dstSize) {
  size_t i = 0;
  for (; src[i] && i + 1 < dstSize; i++) dst[i] = (char)tolower((unsigned char)src[i]);
  dst[i] = '\0';
}

// Reported voltage: the weakest of the three line-to-line measurements,
// rounded to whole volts.
//
// Returns -1 to mean "send no voltage at all", which is the honest answer for
// a meter that did not respond: we have no measurement. `voltage` is optional
// in the schema precisely so that "unmeasured" and "measured as zero" stay
// distinguishable — collapsing them would let a comms fault masquerade as a
// 0 V reading, which is the single highest-confidence outage signal the
// detector has (rules.ts:134).
long gridproofVoltage(const TelemetryRecord &rec) {
  if (rec.online == 0) return -1;

  float lowest = rec.V_L12;
  if (rec.V_L23 < lowest) lowest = rec.V_L23;
  if (rec.V_L31 < lowest) lowest = rec.V_L31;

  // NaN check written as a self-comparison rather than isfinite(): Arduino.h
  // includes <cmath>, which is permitted to undefine the <math.h> macro and
  // leave only std::isfinite, so the bare name is not portable across core
  // versions. `x != x` is true only for NaN and needs no header at all.
  if (lowest != lowest) return 0;

  // A garbled Modbus frame that survives the CRC can decode to an absurd
  // float. Clamping keeps the cast in range (an out-of-range float→long
  // conversion is undefined behaviour) and keeps a nonsense value from being
  // signed and put on chain. 65535 is far above any plausible reading on an
  // 11 kV line-to-line measurement (~10700) yet well inside long.
  if (lowest < 0.0f) return 0;          // schema requires nonnegative
  if (lowest > 65535.0f) return 65535;

  return lroundf(lowest);
}

// grid_up / grid_down / unknown.
//
// A meter that did not answer is `unknown`, never `grid_down` — see the
// header note. Attributing converter latch-up to the provider as downtime
// would be a fabricated outage, and this board has a documented history of
// exactly that fault.
const char* gridproofStatusFor(const TelemetryRecord &rec) {
  if (rec.online == 0) return "unknown";
  long v = gridproofVoltage(rec);
  return (v <= GRIDPROOF_DOWN_VOLTAGE_V) ? "grid_down" : "grid_up";
}

// "<DevEUI>-<unix seconds>" — 16 + 1 + 10 = 27 chars, comfortably over the
// schema's 12-char floor.
//
// Derived purely from fields already in the record, so a reading replayed
// from flash hours later carries the SAME key it would have had at capture
// time. That is what makes retries safe: the API dedupes on this key and
// answers 200 duplicate:true instead of double-counting the reading
// (routes.ts:55). It also lets the two sinks be retried independently with no
// per-record delivery bookkeeping on flash.
void makeIdempotencyKey(const TelemetryRecord &rec, char* out, size_t outSize) {
  snprintf(out, outSize, "%s-%lu", DEV_EUI[rec.meterIndex], (unsigned long)rec.timestamp);
}

// Builds the GridProof request body, signature included.
// Returns false if anything would not fit its buffer.
bool buildGridProofPayload(const TelemetryRecord &rec, char* out, size_t outSize) {
  const char* deviceId = DEV_EUI[rec.meterIndex];
  const char* wallet   = GRIDPROOF_PROVIDER_WALLET[rec.meterIndex];
  const char* zoneId   = GRIDPROOF_ZONE_ID[rec.meterIndex];
  const char* status   = gridproofStatusFor(rec);
  long voltage         = gridproofVoltage(rec);

  char observedAt[25];
  snprintf(observedAt, sizeof(observedAt), "%s", makeTimestamp(rec.timestamp).c_str());

  char idempotencyKey[48];
  makeIdempotencyKey(rec, idempotencyKey, sizeof(idempotencyKey));

  char walletLower[64];
  copyLowered(wallet, walletLower, sizeof(walletLower));

  char voltageStr[16];
  if (voltage < 0) voltageStr[0] = '\0';
  else snprintf(voltageStr, sizeof(voltageStr), "%ld", voltage);

  // Field order and the "." separator must match routes.ts:237-245 exactly.
  // An absent voltage contributes an empty string, so the trailing dot stays.
  char signing[320];
  int sn = snprintf(signing, sizeof(signing), "%s.%s.%s.%s.%s.%s.%s",
                    deviceId, walletLower, zoneId, idempotencyKey,
                    observedAt, status, voltageStr);
  if (sn < 0 || sn >= (int)sizeof(signing)) {
    Serial.println("⚠ buildGridProofPayload: signing string truncated — the signature would be wrong, refusing to send");
    return false;
  }

  char signature[65];
  hmacSha256Hex(GRIDPROOF_HMAC_SECRET, signing, (size_t)sn, signature);

  // `voltage` is omitted entirely rather than sent as null: the schema marks
  // it .optional(), which accepts a missing key but not an explicit null.
  int n;
  if (voltage < 0) {
    n = snprintf(out, outSize,
      "{\"deviceId\":\"%s\",\"providerWallet\":\"%s\",\"zoneId\":\"%s\","
      "\"idempotencyKey\":\"%s\",\"observedAt\":\"%s\",\"status\":\"%s\","
      "\"signature\":\"%s\"}",
      deviceId, wallet, zoneId, idempotencyKey, observedAt, status, signature);
  } else {
    n = snprintf(out, outSize,
      "{\"deviceId\":\"%s\",\"providerWallet\":\"%s\",\"zoneId\":\"%s\","
      "\"idempotencyKey\":\"%s\",\"observedAt\":\"%s\",\"status\":\"%s\","
      "\"voltage\":%ld,\"signature\":\"%s\"}",
      deviceId, wallet, zoneId, idempotencyKey, observedAt, status, voltage, signature);
  }

  if (n < 0 || n >= (int)outSize) {
    Serial.println("⚠ buildGridProofPayload: body truncated — increase the buffer");
    return false;
  }
  return true;
}

// Has this record aged past the point where the API will still accept it?
bool gridProofRecordExpired(const TelemetryRecord &rec) {
  uint32_t now = (uint32_t) time(nullptr);
  if (now < MIN_PLAUSIBLE_EPOCH) return false;   // our own clock is untrustworthy; don't judge
  return (now > rec.timestamp) && (now - rec.timestamp > GRIDPROOF_MAX_RECORD_AGE_S);
}

// POST one record to GridProof.
//
// `permanentFailure` is set when the API rejected the body in a way retrying
// cannot fix (bad signature, malformed field, evidence source disabled). The
// caller then drops the record instead of retrying it forever — without that,
// a single misconfigured constant would wedge the head of the queue and
// silently block every later reading behind it.
bool sendRecordGridProof(const TelemetryRecord &rec, bool &permanentFailure) {
  permanentFailure = false;

  if (!PUBLISH_TO_GRIDPROOF) return true;   // sink disabled — nothing to hold the queue for

  if (rec.timestamp < MIN_PLAUSIBLE_EPOCH) {
    Serial.println("[gridproof] SKIPPED — record predates NTP sync, its observedAt would be rejected as out-of-range");
    permanentFailure = true;
    return false;
  }

  if (gridProofRecordExpired(rec)) {
    stat_gpExpired++;
    Serial.printf("[gridproof] GIVING UP on %s-%lu — older than the API's %lus ingestion window\n",
                  DEV_EUI[rec.meterIndex], (unsigned long)rec.timestamp,
                  (unsigned long)GRIDPROOF_MAX_RECORD_AGE_S);
    permanentFailure = true;
    return false;
  }

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[gridproof] SKIPPED — WiFi down");
    return false;
  }

  char body[640];
  if (!buildGridProofPayload(rec, body, sizeof(body))) {
    permanentFailure = true;   // our own bug, not a transient one — retrying is pointless
    return false;
  }

  stat_gpAttempts++;

  HTTPClient http;
  char url[192];
  snprintf(url, sizeof(url), "https://%s:%d%s", GRIDPROOF_API_HOST, GRIDPROOF_API_PORT, GRIDPROOF_API_PATH);

  http.setTimeout(GRIDPROOF_HTTP_TIMEOUT_MS);
  http.setConnectTimeout(GRIDPROOF_HTTP_TIMEOUT_MS);
  if (!http.begin(apiTlsClient, url)) {
    Serial.println("[gridproof] http.begin() FAILED — check the URL");
    return false;
  }
  http.addHeader("Content-Type", "application/json");

  int code = http.POST((uint8_t*)body, strlen(body));
  lastGpHttpCode = code;
  String response = (code > 0) ? http.getString() : String();
  http.end();   // release the TLS session promptly — it is the largest heap consumer here

  // 202 = accepted, 200 = already had this idempotencyKey (routes.ts:55).
  if (code == 200 || code == 202) {
    stat_gpSuccess++;
    if (code == 200) stat_gpDuplicates++;
    lastGpOkAt = millis();
    Serial.printf("[gridproof] POST OK %d%s → %s\n   body: %s\n",
                  code, code == 200 ? " (duplicate — already ingested)" : "", url, body);
    return true;
  }

  if (code == 429) {
    // Rate limited (middleware/rate-limit.ts). Transient by construction —
    // the bucket rolls over — so this record stays queued.
    Serial.printf("[gridproof] RATE LIMITED (429) — will retry\n   response: %s\n", response.c_str());
    return false;
  }

  if (code >= 400 && code < 500) {
    // 400 OBSERVED_AT_OUT_OF_RANGE / 401 BAD_SIGNATURE / 403
    // EVIDENCE_SOURCE_DISABLED are all configuration faults. Retrying
    // re-sends identical bytes and gets an identical answer.
    stat_gpRejected++;
    permanentFailure = true;
    Serial.printf("[gridproof] REJECTED %d — permanent, dropping this record\n   body: %s\n   response: %s\n",
                  code, body, response.c_str());
    return false;
  }

  // 5xx, or a negative HTTPClient error code (connection/TLS/timeout).
  Serial.printf("[gridproof] POST FAILED code=%d — will retry\n   response: %s\n", code, response.c_str());
  return false;
}

// ── MQTT connection ──────────────────────────────────────────────────────────
// Translates PubSubClient's numeric state() into something you can actually
// act on, instead of just "state=-2".
const char* mqttStateStr(int state) {
  switch (state) {
    case -4: return "MQTT_CONNECTION_TIMEOUT (broker not responding)";
    case -3: return "MQTT_CONNECTION_LOST (dropped after connect)";
    case -2: return "MQTT_CONNECT_FAILED (TCP/TLS handshake failed — check host/port/cert)";
    case -1: return "MQTT_DISCONNECTED";
    case  0: return "MQTT_CONNECTED";
    case  1: return "MQTT_CONNECT_BAD_PROTOCOL";
    case  2: return "MQTT_CONNECT_BAD_CLIENT_ID";
    case  3: return "MQTT_CONNECT_UNAVAILABLE (broker rejected — server unavailable)";
    case  4: return "MQTT_CONNECT_BAD_CREDENTIALS (username/password rejected)";
    case  5: return "MQTT_CONNECT_UNAUTHORIZED (check client cert / CN / broker ACL)";
    default: return "UNKNOWN STATE";
  }
}

bool mqttReconnect() {
  if (mqttClient.connected()) return true;
  if (WiFi.status() != WL_CONNECTED) return false;

  unsigned long now = millis();
  if (now - lastMqttAttempt < MQTT_RECONNECT_INTERVAL_MS) return false;  // ← throttle
  lastMqttAttempt = now;

  Serial.printf("Free heap before TLS attempt: %u bytes\n", ESP.getFreeHeap());
  Serial.print("Connecting to PowerTech MQTT broker...");
  bool ok = mqttClient.connect(MQTT_CLIENT_ID, MQTT_USERNAME, MQTT_PASSWORD);
  if (ok) {
    Serial.println(" connected");
  } else {
    char errBuf[100];
    tlsClient.lastError(errBuf, sizeof(errBuf));   // ← the actual mbedTLS reason
    Serial.printf(" FAILED — state=%d (%s)\n   TLS detail: %s\n",
                  mqttClient.state(), mqttStateStr(mqttClient.state()), errBuf);
  }
  return ok;
}

// Publish a single record. PubSubClient only publishes at QoS 0 regardless
// of the qos value requested — consistent with what your mosquitto_pub test
// used. If PowerTech's broker ever requires QoS 1 acknowledgment, swap in a
// library that supports it (e.g. 256dpi/arduino-mqtt).
bool sendRecordMQTT(const TelemetryRecord &rec) {
  if (!PUBLISH_TO_POWERTECH) return true;   // sink disabled — nothing to hold the queue for

  stat_mqttAttempts++;

  if (!mqttReconnect()) {
    Serial.printf("[%s] MQTT PUBLISH SKIPPED — client not connected\n", DEV_EUI[rec.meterIndex]);
    return false;
  }

  String payload = buildPayload(rec);
  bool ok = mqttClient.publish(MQTT_TOPIC, (const uint8_t*)payload.c_str(), payload.length(), false);

  if (ok) {
    stat_mqttSuccess++;
    lastMqttOkAt = millis();
    Serial.printf("[%s] MQTT PUBLISH OK → '%s' (%u bytes)\n   payload: %s\n",
                  DEV_EUI[rec.meterIndex], MQTT_TOPIC, (unsigned)payload.length(), payload.c_str());
  } else {
    Serial.printf("[%s] MQTT PUBLISH FAILED — publish() returned false (payload %u bytes, buffer %u) state=%d (%s)\n",
                  DEV_EUI[rec.meterIndex], (unsigned)payload.length(), mqttClient.getBufferSize(),
                  mqttClient.state(), mqttStateStr(mqttClient.state()));
  }
  return ok;
}

// Delivers one record to every enabled sink.
//
// Returns true only when the record is finished with — either every sink
// accepted it, or a sink failed permanently and there is no point keeping it.
//
// A partial success followed by a later retry re-sends to the sink that
// already succeeded. That is deliberate: GridProof deduplicates on
// idempotencyKey so the repeat is a no-op there, and PowerTech's payload is a
// plain periodic reading where a repeat is harmless. Paying for that with an
// occasional duplicate publish is much cheaper than tracking per-sink
// delivery state on flash, which would have changed the on-disk record format
// and invalidated every reading buffered by the previous firmware.
bool deliverRecord(const TelemetryRecord &rec) {
  bool mqttOk = sendRecordMQTT(rec);

  bool gpPermanent = false;
  bool gpOk = sendRecordGridProof(rec, gpPermanent);

  return mqttOk && (gpOk || gpPermanent);
}

// Called after each reading. Publishes immediately; on any failure, buffers
// the reading to flash instead of dropping it.
void postTelemetry(uint8_t meterIndex, bool online,
                    float I_L1, float I_L2, float I_L3,
                    float V_L12, float V_L23, float V_L31,
                    float activePowerInst, float reactivePowerInst, float apparentPowerInst,
                    float powerFactorAvg, float freqAvg,
                    uint32_t activeEnergyTot, uint32_t reactiveEnergyTot, uint32_t apparentEnergyTot) {

  TelemetryRecord rec;
  rec.timestamp = (uint32_t) time(nullptr);
  rec.meterIndex = meterIndex;
  rec.online = online ? 1 : 0;
  rec.I_L1 = I_L1; rec.I_L2 = I_L2; rec.I_L3 = I_L3;
  rec.V_L12 = V_L12; rec.V_L23 = V_L23; rec.V_L31 = V_L31;
  rec.activePowerInst = activePowerInst;
  rec.reactivePowerInst = reactivePowerInst;
  rec.apparentPowerInst = apparentPowerInst;
  rec.powerFactorAvg = powerFactorAvg;
  rec.freqAvg = freqAvg;
  rec.activeEnergyTot = activeEnergyTot;
  rec.reactiveEnergyTot = reactiveEnergyTot;
  rec.apparentEnergyTot = apparentEnergyTot;

  if (PUBLISH_TO_GRIDPROOF) {
    long v = gridproofVoltage(rec);
    Serial.printf("[gridproof] %s → status=%s voltage=", DEV_EUI[meterIndex], gridproofStatusFor(rec));
    if (v < 0) Serial.println("<omitted, meter silent>");
    else Serial.printf("%ld\n", v);
  }

  if (!deliverRecord(rec)) {
    if (enqueueRecord(rec)) {
      Serial.println("→ Buffering reading to flash (a sink did not accept it)");
    } else {
      Serial.println("→ !!! LittleFS WRITE FAILED — reading LOST, not buffered !!!");
    }
  }
}

// Try to drain queued readings, oldest first. Capped per call so a big
// backlog doesn't stall live readings for too long.
void flushQueue() {
  uint32_t backlog = queueRecordCount();
  if (backlog == 0) return;
  if (WiFi.status() != WL_CONNECTED) return;

  Serial.printf("Flushing queue — %u buffered readings\n", backlog);

  TelemetryRecord rec;
  int sent = 0;
  while (sent < MAX_FLUSH_PER_LOOP && dequeuePeekRecord(rec)) {
    esp_task_wdt_reset();   // each pass can spend seconds in TLS
    if (deliverRecord(rec)) {
      dequeueAdvance();
      sent++;
    } else {
      Serial.println("Flush send failed — will retry next loop");
      break;
    }
  }
}

// ── Status summary — one glanceable block per cycle ─────────────────────────
// This is the answer to "is it reading the meter / sending to MQTT / posting
// to GridProof or not": check this block instead of scrolling back through
// per-register logs.
void printStatusSummary() {
  unsigned long now = millis();
  Serial.println("\n════════════════ STATUS SUMMARY ════════════════");
  Serial.printf("Uptime: %lus   WiFi: %s%s   MQTT: %s\n",
                now / 1000,
                WiFi.status() == WL_CONNECTED ? "CONNECTED" : "DISCONNECTED",
                WiFi.status() == WL_CONNECTED ? (String(" (RSSI ") + WiFi.RSSI() + "dBm)").c_str() : "",
                mqttClient.connected() ? "CONNECTED" : "DISCONNECTED");

  for (int i = 0; i < 2; i++) {
    Serial.printf("Meter %d: %u/%u read cycles OK", i + 1, stat_modbusSuccess[i], stat_modbusAttempts[i]);
    if (lastModbusOkAt[i] == 0) Serial.println("  — no successful read yet");
    else Serial.printf("  — last OK %lus ago\n", (now - lastModbusOkAt[i]) / 1000);
  }

  Serial.printf("MQTT: %u/%u publishes OK", stat_mqttSuccess, stat_mqttAttempts);
  if (lastMqttOkAt == 0) Serial.println("  — no successful publish yet");
  else Serial.printf("  — last OK %lus ago\n", (now - lastMqttOkAt) / 1000);

  if (PUBLISH_TO_GRIDPROOF) {
    Serial.printf("GridProof: %u/%u posts OK (%u dup, %u rejected, %u expired)  last HTTP %d",
                  stat_gpSuccess, stat_gpAttempts, stat_gpDuplicates,
                  stat_gpRejected, stat_gpExpired, lastGpHttpCode);
    if (lastGpOkAt == 0) Serial.println("  — no successful post yet");
    else Serial.printf("  — last OK %lus ago\n", (now - lastGpOkAt) / 1000);
    if (stat_gpRejected > 0)
      Serial.println("   ⚠ rejections are configuration faults (signature / zone / wallet / evidence mode), not network trouble");
  } else {
    Serial.println("GridProof: DISABLED at compile time");
  }

  Serial.printf("Offline queue backlog: %u records (%u bytes)\n", queueRecordCount(), (unsigned)queueUsedBytes());

  // Field-reliability hardening: heap trend + self-heal state, so a slow
  // leak/fragmentation shows up in the log instead of only as a mystery
  // failure hours later.
  Serial.printf("Heap: %u bytes free now, %u bytes min-ever-free  |  PSRAM free: %u bytes\n",
                ESP.getFreeHeap(), ESP.getMinFreeHeap(), ESP.getFreePsram());
  Serial.printf("Consecutive total-Modbus-failure cycles: %u  (relay cycle at %d, reboot at %d)\n",
                consecutiveFullFailures, FULL_FAILURE_CYCLES_BEFORE_RELAY_CYCLE, FULL_FAILURE_CYCLES_BEFORE_REBOOT);
  Serial.printf("Relay power-cycles this outage: %u/%u", relayCycleAttempts, MAX_RELAY_CYCLES_BEFORE_PAUSING);
  if (lastRelayCycleAt == 0) Serial.println("  — none yet");
  else Serial.printf("  — last one %lus ago\n", (now - lastRelayCycleAt) / 1000);

  Serial.println("══════════════════════════════════════════════\n");
}

// Fails loudly at boot rather than posting garbage for hours. None of these
// can be checked at compile time because they are string contents, so this is
// the earliest possible point to catch them.
void validateGridProofConfig() {
  if (!PUBLISH_TO_GRIDPROOF) return;

  bool ok = true;
  for (int i = 0; i < 2; i++) {
    if (strcmp(GRIDPROOF_PROVIDER_WALLET[i], "0x0000000000000000000000000000000000000000") == 0) {
      Serial.printf("⚠ GRIDPROOF_PROVIDER_WALLET[%d] is still the placeholder zero address\n", i);
      ok = false;
    }
    if (strlen(GRIDPROOF_PROVIDER_WALLET[i]) != 42) {
      Serial.printf("⚠ GRIDPROOF_PROVIDER_WALLET[%d] is not 42 chars — the API's regex will reject it\n", i);
      ok = false;
    }
    if (strcmp(GRIDPROOF_ZONE_ID[i], "00000000-0000-0000-0000-000000000000") == 0) {
      Serial.printf("⚠ GRIDPROOF_ZONE_ID[%d] is still the placeholder nil UUID\n", i);
      ok = false;
    }
    if (strlen(GRIDPROOF_ZONE_ID[i]) != 36) {
      Serial.printf("⚠ GRIDPROOF_ZONE_ID[%d] is not 36 chars — not a UUID\n", i);
      ok = false;
    }
  }
  if (strcmp(GRIDPROOF_HMAC_SECRET, "REPLACE_WITH_TELEMETRY_HMAC_SECRET") == 0) {
    Serial.println("⚠ GRIDPROOF_HMAC_SECRET is still the placeholder — every post will 401 once the API has a secret set");
    ok = false;
  }
  if (GRIDPROOF_TLS_INSECURE_TESTING_ONLY)
    Serial.println("⚠ GridProof TLS server verification DISABLED — bring-up only, do not ship like this");

  if (!ok)
    Serial.println("⚠⚠ GridProof config incomplete — posts will be rejected until the values above are filled in.");
  else
    Serial.println("✓ GridProof config is structurally valid (contents still unverified against the database)");
}

// ── Setup ────────────────────────────────────────────────────────────────────
unsigned long lastPublish = 0;

void setup() {
  Serial.begin(115200);   // debug console. NOT the RS485 baud — that's BAUD (38400), set separately below.
  while (!Serial) {}

  // NOTE: if you're on the "16M Flash (3MB APP/9.9MB FATFS)" partition scheme,
  // the data partition is labeled "ffat", not "spiffs" — LittleFS.begin(true)
  // alone will fail with "partition spiffs could not be found". Either pass
  // the label explicitly, as below, or switch to a custom partition table with
  // a partition actually named "spiffs".
  if (!LittleFS.begin(true, "/littlefs", 10, "ffat")) {
    Serial.println("LittleFS mount FAILED — offline buffering will silently no-op until fixed!");
  } else {
    Serial.printf("LittleFS ready. Buffered readings on boot: %u\n", queueRecordCount());
  }
  prefs.begin("telemetry", false);

  RS485.begin(BAUD, SERIAL_8N1, RX_PIN, TX_PIN);   // ONE bus — both meters multi-dropped
  delay(500);

  pinMode(RELAY_PIN, OUTPUT);
  setRelay(false);   // start de-energized — NC closed — converter powered (fail-safe default)

  Serial.println("ME371 x2 Reader (shared RS485 bus) → PowerTech MQTT + GridProof (ESP32-S3)");
  Serial.printf("Meter1: Slave %d   Meter2: Slave %d   (same UART/pins)\n", SLAVE_ID_1, SLAVE_ID_2);
  Serial.printf("Relay: GPIO %d, %s trigger, NC wiring (fail-safe)\n", RELAY_PIN, RELAY_ACTIVE_HIGH ? "active-HIGH" : "active-LOW");
  Serial.printf("Sinks: PowerTech MQTT %s, GridProof HTTPS %s\n",
                PUBLISH_TO_POWERTECH ? "ON" : "OFF", PUBLISH_TO_GRIDPROOF ? "ON" : "OFF");

  connectWiFi();

  configTime(GMT_OFFSET, DST_OFFSET, NTP_SERVER);   // true GMT, per PowerTech's guide
  Serial.println("Waiting for NTP time sync...");
  struct tm timeinfo;
  unsigned long start = millis();
  while (!getLocalTime(&timeinfo) && millis() - start < 15000) {
    Serial.print(".");
    delay(500);
  }
  if (getLocalTime(&timeinfo)) {
    Serial.printf("\nTime synced (GMT): %04d-%02d-%02dT%02d:%02d:%02dZ\n",
      timeinfo.tm_year + 1900, timeinfo.tm_mon + 1, timeinfo.tm_mday,
      timeinfo.tm_hour, timeinfo.tm_min, timeinfo.tm_sec);
  } else {
    // Matters more than it used to. MQTT accepts any timestamp; GridProof
    // rejects an observedAt more than 24h old outright (routes.ts:137-163),
    // and an unsynced clock reads as 1970. Readings taken before sync are
    // still buffered — sendRecordGridProof refuses to sign them until the
    // clock passes MIN_PLAUSIBLE_EPOCH, and NTP retries in the background.
    Serial.println("\nNTP sync failed — GridProof posts are held (not signed with a 1970 timestamp) until it succeeds");
  }

  // TLS + MQTT setup
  if (MQTT_TLS_INSECURE_TESTING_ONLY) {
    Serial.println("⚠ MQTT TLS server verification DISABLED — testing only, do not ship like this");
    tlsClient.setInsecure();
  } else {
    tlsClient.setCACert(MQTT_CA_CERT);
  }
  tlsClient.setCertificate(MQTT_CLIENT_CERT);
  tlsClient.setPrivateKey(MQTT_CLIENT_KEY);
  mqttClient.setServer(MQTT_BROKER_HOST, MQTT_BROKER_PORT);
  mqttClient.setBufferSize(1024);   // default 256 bytes is too small for this JSON payload

  // TLS for the GridProof API. Server-auth only — the API authenticates the
  // device with the HMAC signature, not a client certificate, so no client
  // cert/key is set here.
  if (GRIDPROOF_TLS_INSECURE_TESTING_ONLY) {
    apiTlsClient.setInsecure();
  } else {
    apiTlsClient.setCACert(GRIDPROOF_CA_CERT);
  }

  validateGridProofConfig();

  mqttReconnect();   // first connection attempt, don't wait for the loop

  // Hardware watchdog — hard safety net. If loop() ever truly hangs (stuck
  // TLS handshake, etc.) this reboots the MCU instead of it sitting dead
  // until someone notices data stopped coming in. See the note at
  // HW_WATCHDOG_TIMEOUT_S for why the timeout is what it is.
  esp_task_wdt_config_t twdt_config = {
    .timeout_ms = HW_WATCHDOG_TIMEOUT_S * 1000,
    .idle_core_mask = 0,
    .trigger_panic = true
  };
  esp_task_wdt_deinit();           // clear any default WDT config the core may have set up already
  esp_task_wdt_init(&twdt_config);
  esp_task_wdt_add(NULL);
}

// ── Loop ─────────────────────────────────────────────────────────────────────
void loop() {
  esp_task_wdt_reset();   // feed the hardware watchdog every iteration

  if (WiFi.status() != WL_CONNECTED) connectWiFi();
  mqttReconnect();
  mqttClient.loop();   // service MQTT keepalive between publish cycles

  if (millis() - lastPublish < PUBLISH_INTERVAL_MS) {
    delay(50);
    return;
  }
  lastPublish = millis();

  // Drain any backlog before sending a fresh reading, so order stays roughly
  // chronological and the queue doesn't grow unbounded during an outage.
  flushQueue();
  esp_task_wdt_reset();   // the flush above can spend a while in TLS

  bool m1_online = false;
  bool m2_online = false;

  // ── Meter 1 (Slave ID 1) ──
  {
    float I_L1=0, I_L2=0, I_L3=0;
    float V_L12=0, V_L23=0, V_L31=0;
    float activeP=0, reactiveP=0, apparentP=0;
    float pf=0, freq=0;
    uint32_t eActive=0, eReactive=0, eApparent=0;

    m1_online = readMeter(RS485, SLAVE_ID_1, 0, "Meter 1",
                                I_L1, I_L2, I_L3,
                                V_L12, V_L23, V_L31,
                                activeP, reactiveP, apparentP,
                                pf, freq,
                                eActive, eReactive, eApparent);

    // Zeroing here is for the PowerTech payload's benefit — it wants a full
    // set of numeric fields. GridProof does NOT read these zeros as an outage:
    // gridproofStatusFor() branches on rec.online first and reports `unknown`,
    // sending no voltage at all. Keep that ordering if you ever refactor this.
    if (!m1_online) {
      Serial.println("Meter 1 offline — zeroing all parameters");
      I_L1 = I_L2 = I_L3 = 0;
      V_L12 = V_L23 = V_L31 = 0;
      activeP = reactiveP = apparentP = 0;
      pf = 0; freq = 0;
      eActive = eReactive = eApparent = 0;
    }

    postTelemetry(0, m1_online,
                  I_L1, I_L2, I_L3,
                  V_L12, V_L23, V_L31,
                  activeP, reactiveP, apparentP,
                  pf, freq,
                  eActive, eReactive, eApparent);
  }

  esp_task_wdt_reset();   // postTelemetry() above may have made a TLS POST
  delay(200);   // brief gap so bus turnaround from Meter 1 fully settles before Meter 2

  // ── Meter 2 (Slave ID 2) ──
  {
    float I_L1=0, I_L2=0, I_L3=0;
    float V_L12=0, V_L23=0, V_L31=0;
    float activeP=0, reactiveP=0, apparentP=0;
    float pf=0, freq=0;
    uint32_t eActive=0, eReactive=0, eApparent=0;

    m2_online = readMeter(RS485, SLAVE_ID_2, 1, "Meter 2",
                                I_L1, I_L2, I_L3,
                                V_L12, V_L23, V_L31,
                                activeP, reactiveP, apparentP,
                                pf, freq,
                                eActive, eReactive, eApparent);

    if (!m2_online) {
      Serial.println("Meter 2 offline — zeroing all parameters");
      I_L1 = I_L2 = I_L3 = 0;
      V_L12 = V_L23 = V_L31 = 0;
      activeP = reactiveP = apparentP = 0;
      pf = 0; freq = 0;
      eActive = eReactive = eApparent = 0;
    }

    postTelemetry(1, m2_online,
                  I_L1, I_L2, I_L3,
                  V_L12, V_L23, V_L31,
                  activeP, reactiveP, apparentP,
                  pf, freq,
                  eActive, eReactive, eApparent);
  }

  esp_task_wdt_reset();

  // ── Self-healing: power-cycle the RS485 converter itself ──────────────────
  // A firmware-side reset (UART reinit, ESP.restart()) can't clear a latched
  // transceiver chip, because neither one ever removes power from it. Once
  // both meters have returned zero output for one full publish cycle (~1
  // minute, per PUBLISH_INTERVAL_MS), cut and restore power to the converter
  // via the relay instead.
  bool bothOffline = !m1_online && !m2_online;
  if (bothOffline) {
    consecutiveFullFailures++;
    Serial.printf("⚠ Both meters unreachable this cycle (%u consecutive cycle(s) with zero response from either meter)\n", consecutiveFullFailures);

    if (relayCycleAttempts < MAX_RELAY_CYCLES_BEFORE_PAUSING) {
      powerCycleRS485Converter();
    } else if (relayCycleAttempts == MAX_RELAY_CYCLES_BEFORE_PAUSING) {
      Serial.printf("⚠ %u relay power-cycles attempted with no recovery — pausing auto power-cycling. "
                    "Likely a genuine extended feeder outage, or the converter needs a manual check.\n",
                    relayCycleAttempts);
      relayCycleAttempts++;   // bump past the cap so this message only prints once per outage
    }
  } else {
    if (consecutiveFullFailures > 0) {
      Serial.println("✓ Modbus communication recovered — resetting failure/relay counters");
    }
    consecutiveFullFailures = 0;
    relayCycleAttempts = 0;
  }

  if (consecutiveFullFailures >= FULL_FAILURE_CYCLES_BEFORE_REBOOT) {
    Serial.println("⚠⚠ Still completely dead after repeated relay power-cycles — restarting ESP32 as a further fallback");
    Serial.flush();
    delay(200);
    ESP.restart();
  }

  printStatusSummary();
}
