# Pulsar X3 configuration protocol

Reverse-engineering notes for the Pulsar X3 as driven by Pulsar Fusion2. Everything
marked **verified** was exercised live on 2026-10-13 against an X3 (firmware 1.0.16)
paired to the 1K dongle, VID `0x3710` PID `0x5402`, from Windows 11 over hidapi, with
every write read back and restored. The final pass is scripted in `tools/validate.py`
and its output is in `docs/validation-2026-10-13.json`: 29 checks, 86 transactions, no
checksum errors, round trips 0-47 ms (median 31 ms). The frame format and most registers were first
documented by the Linux community projects listed at the end; this file adds what was
confirmed or discovered on the X3 and what matters for a WebHID implementation.

## Transport

The dongle enumerates as a USB composite device with four interfaces:

| Interface | HID collections | Role |
|---|---|---|
| 0 | Generic Desktop / Mouse | the actual mouse |
| 1 | Keyboard, Consumer, System Control, two `usagePage 0x01 usage 0x00` collections | keyboard emulation for remapped buttons; the usage-0 collections push the unsolicited reports below |
| 2 | `usagePage 0xFFFF usage 0x01`, 64-byte in/out/feature report ID 0 | **silent**: never answers |
| 3 | identical descriptor to interface 2 | **the configuration channel** |

Report descriptor of interfaces 2 and 3 (44 bytes):

```
06 ff ff 09 01 a1 01  09 02 15 81 25 7f 75 08 95 40 81 02   input  64 bytes
                      09 03 15 81 25 7f 75 08 95 40 91 02   output 64 bytes
                      09 04 15 81 25 7f 75 08 95 40 b1 82   feature 64 bytes
c0
```

Commands are sent as a **feature report** (SET_REPORT, report ID 0, 64 bytes) and the
answer is fetched with GET_REPORT on the same report. In WebHID that is
`sendFeatureReport(0, cmd)` followed by `receiveFeatureReport(0)`; Chrome returns 65
bytes with the report ID prepended, so drop byte 0 before parsing.

Interfaces 2 and 3 look identical to WebHID, which does not expose interface numbers.
The app opens every matching collection and keeps the one that answers a firmware read.

### Frame layout

```
byte  0     direction / status
            0x00 command (host → device)
            0x01 answer  (device → host)
            0x02 pending: the dongle is still waiting for the mouse
            0x03, 0x04 rejected / unsupported register (seen for 05 85 05 and 01 82 01)
            0x05 mouse asleep / out of range: see "Status 0x05" below
byte  1     category
byte  2     register; bit 7 set = read, clear = write
byte  3     sub-register
bytes 4-5   0x00
byte  6     profile: 0x00 = global / active, 0x01..0x05 = stored profile
bytes 7-61  payload
bytes 62-63 checksum: little-endian uint16 of sum(bytes[0..61])
```

Answers echo category, register and profile of the request. The sub-register is **not**
reliably echoed: the DPI-stage read is sent with sub `0x15` and answered with `0x0d` or
`0x21` (the only mismatches in 86 transactions were those reads). Checksums were correct
on every answer. Answers reuse a buffer, so bytes beyond the documented payload may hold stale
data from an earlier reply; never parse past the documented offsets.

### Handshake over the dongle (verified)

Every command is a radio round trip. After SET_REPORT, GET_REPORT returns the request
echoed with byte 0 = `0x02` until the mouse has answered. Reads answered on the second
poll (about 11-16 ms after the request, 30 ms wall-clock including the first poll);
writes took 16-32 ms. Fusion2 re-polls every 15-30 ms and never sends the next command
until it holds the `0x01`. A SET_REPORT sent while one is pending is dropped and its
late reply is handed to whoever reads next, so a client must serialise all traffic and
match answers by category/register/profile.

### Status 0x05: mouse asleep (verified)

While the mouse is asleep (the sleep timer defaults to 30 s of idling) the dongle answers
**every** request, even a plain battery read, with byte 0 = `0x05` immediately. Moving
the mouse clears it. Earlier in this work the state was misread as a "latch" caused by an
unsupported request; the real trigger was simply the idle timer running out between
probes. A client should treat `0x05` as "wake the mouse and retry", not as a protocol
error.

### Unsolicited reports (verified)

On interface 1, in the `usagePage 0x01 usage 0x00` collections (input reports, no ID):

```
05 0d <pct>                      about once a second: link quality 0-100 (read 100, 97, 91)
04 80 00 00 ...                  about twice a second: unknown
05 05 <stage-1> <dpiLo> <dpiHi>  DPI changed with the button (from the Feinmann 8K driver; not yet seen on X3)
```

## Registers

`cat reg sub` are the bytes for a write; a read sets bit 7 of `reg`. "P" is the profile
byte that works. Offsets are into the 64-byte answer.

### Identity

| Register | P | Answer | Status |
|---|---|---|---|
| `01 04 04` read | 0 | bytes 6-7 VID, 8-9 PID of the paired mouse, LE (`10 37 09 34` = 3710:3409 = X3) | verified, dongle only |
| `01 07 04` read | 0 | bytes 6-7 = `16 10` on a mouse Fusion labels 1.0.16 | verified |
| `01 01 01` read | 0 | byte 6 = `ff` | unknown |
| `01 05 02` read | 0 | byte 6 = `02` | unknown |
| `01 06 02` read | 0 | bytes 6-7 = `01 01` | unknown |
| `01 08 04` read | 0 | bytes 6-7 = `00 10` | unknown |
| `02 06 01` read | 0 | times out (active profile on X2A / Feinmann) | not implemented on X3 |

### Performance (global, profile 0)

| Register | Payload / answer | Status |
|---|---|---|
| `01 09 02` | byte 7 = polling bitmask: 125 Hz `01`, 250 `02`, 500 `04`, 1000 `08`, 2000 `10`, 4000 `20`, 8000 `40` | verified 1000 ↔ 500 on the 1K dongle; 2K+ need the 8K dongle |
| `04 03 03` | byte 7 = debounce in ms (Fusion slider 0-20) | verified 2 ↔ 3 |
| `07 03 02` | byte 7 = ripple control 0/1 | verified 0 ↔ 1 |
| `07 04 02` | byte 7 = angle snapping 0/1 | verified 0 ↔ 1 |
| `07 05 02` | byte 7 = motion sync 0/1 | verified 1 ↔ 0 |

### Per-profile (profile 1 = the profile the X3 runs; profile 0 untested here, it was only tried while the mouse slept)

| Register | Payload / answer | Status |
|---|---|---|
| `07 02 03` | write `[02, mm×10]`; read byte 8 = mm×10 (7 = 0.7 mm, 10 = 1 mm, 20 = 2 mm) | verified 10 ↔ 20; a read with P=0 returns the same value as P=1 |
| `05 04 15` read / `05 04 21` write | byte 7 = active stage (1-based), byte 8 = stage count, then 5 bytes per stage `[index, xLo, xHi, yLo, yHi]`. Slots beyond `count` hold leftovers (factory 400/800/1600/3200/6400/12800). | verified: idempotent write, then 800 → 810 on the active stage; `05 02 05` followed immediately; restored |
| `05 01 02` | byte 7 = active DPI stage | verified 2 ↔ 1: `05 02 05` and byte 7 of the `05 04 15` table follow the write; P=0 or 1 both answer |
| `05 02 05` read | bytes 7-8 = current X DPI, 9-10 = Y, LE | verified |
| `05 02 05` write | `[xLo, xHi, yLo, yHi]` sets the current stage's DPI (from pulsar-x3-python) | not exercised here |
| `05 05 05` | payload `[stage]`; bytes 8-10 = RGB of that stage's indicator | stage 1 answers `0a 0a dc` (reproducible); stage 2 timed out; the X3 has no RGB |
| `04 01 06` read | payload `[buttonId, ff]`; bytes 8-10 = `[type, a1, a2]` | verified for IDs 1-6, 0x0b |
| `04 01 06` write | payload `[buttonId, type, a1, a2]` | verified: DPI button `09 03 00` → `09 01 00` (DPI up) and side-back `01 05 00` → `02 01 06` (Ctrl+C), both read back and restored |
| `03 03 03` | payload `[01]`; byte 8 = brightness (read `ff`) | X3 has no LED |
| `03 04 0f` | payload `[01]`; byte 8 = effect, byte 11 = breathe speed | X3 has no LED |

Button IDs on the X3: `01` left, `02` right, `03` wheel, `04` side front, `05` side back,
`0b` DPI button on the underside. `06` answers with a forward binding but has no physical
button. `0c` answers all zeros.

Binding types: `00` disabled, `01` mouse (`a1` = 1 left, 2 right, 3 middle, 4 forward,
5 back), `02` keyboard (`a1` = HID modifier bits, `a2` = HID usage), `03` scroll (`a1` =
`01` up, `ff` down), `08` profile (`a1` = 3 next, 4 previous), `09` DPI (`a1` = 1 up, 2
down, 3 cycle), `0d` consumer control (`a1 a2` = usage LE, e.g. `cd 00` play/pause),
`0e` double click.

### Power (cat 0x08, profile 0)

| Register | Answer | Status |
|---|---|---|
| `08 01 01` read | byte 6 = battery %, `ff` when the dongle has no mouse | verified (51 %) |
| `08 03 01` read | byte 6 = 1 while charging | verified read (0) |
| `08 05 03` | bytes 7-8 = sleep timer in seconds, uint16 LE (Fusion: 30-900) | verified 30 ↔ 60 |
| `08 08 02` | byte 7 = Low Power Mode threshold in % | verified 10 ↔ 15 |
| `08 02 01` read | byte 6 = 0 | unknown |
| `08 04 02` read | byte 7 = 1 | unknown, possibly "low power mode enabled" |

### Factory reset (not exercised on the X3)

Fusion sends `02 05 01` then `02 06 01` with the profile byte set. On an X2A this
resets that profile and all globals. The second frame may go unanswered.

## Sources

* [packerlschupfer/pulsar-mouse-linux](https://github.com/packerlschupfer/pulsar-mouse-linux): X2A, Xlite v4, X3 and 1K-dongle drivers, including the pending/answer handshake ([PR #14](https://github.com/packerlschupfer/pulsar-mouse-linux/pull/14), [PR #15](https://github.com/packerlschupfer/pulsar-mouse-linux/pull/15)).
* [jonkristian/pulsar-x3-python](https://github.com/jonkristian/pulsar-x3-python): X3 captures, LOD encoding, firmware register.
* [andrewrabert/python-pulsar-mouse-tool](https://github.com/andrewrabert/python-pulsar-mouse-tool): the original Wireshark work on the X2 v2 Mini.
* [OpenMouse](https://github.com/OpenMouse-Project/openmouse): WebHID notes on the Pulsar X2A v3 / 8K receiver.
