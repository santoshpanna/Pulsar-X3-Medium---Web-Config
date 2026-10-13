"""Live validation of the Pulsar X3 register map in src/protocol/device.ts.

    pip install hidapi
    python tools/validate.py

Every writable register is read, changed, read back, restored and read back
again, so the mouse ends up exactly as it started. Needs the mouse awake and
nothing else (Pulsar Fusion, the web page) talking to the dongle. Writes
report.json next to this file. Tested on Windows 11 with the 1K dongle.
"""
import hid, struct, time, json, sys, os

VID, PID = 0x3710, 0x5402
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'report.json')
IFACE = int(sys.argv[1]) if len(sys.argv) > 1 else 3  # the dongle's answering vendor interface


def build(cat, reg, sub, profile=0, payload=()):
    buf = bytearray(64)
    buf[1], buf[2], buf[3], buf[6] = cat, reg, sub, profile
    for i, b in enumerate(payload):
        buf[7 + i] = b
    struct.pack_into('<H', buf, 62, sum(buf[:62]) & 0xFFFF)
    return bytes(buf)


def hx(b, n=None):
    return bytes(b[:n] if n else b).hex(' ')


class Asleep(Exception):
    pass


class Nak(Exception):
    pass


class Timeout(Exception):
    pass


stats = {'tx': 0, 'checksum_bad': 0, 'sub_mismatch': 0, 'ms': []}


def transact(dev, cmd, timeout=1.0):
    dev.send_feature_report(b'\x00' + cmd)
    stats['tx'] += 1
    t0 = time.monotonic()
    deadline = t0 + timeout
    saw_pending = False
    last = None
    while True:
        rsp = bytes(dev.get_feature_report(0, 65))
        rsp = rsp[1:] if len(rsp) == 65 else rsp
        last = rsp
        echoes = rsp[1:3] == cmd[1:3]
        prof_ok = cmd[6] == 0 or rsp[6] == cmd[6]
        if rsp[0] == 0x01 and echoes and prof_ok:
            stats['ms'].append(1000 * (time.monotonic() - t0))
            if struct.unpack_from('<H', rsp, 62)[0] != (sum(rsp[:62]) & 0xFFFF):
                stats['checksum_bad'] += 1
            if rsp[3] != cmd[3]:
                stats['sub_mismatch'] += 1
            return rsp
        if rsp[0] in (0x03, 0x04) and echoes:
            raise Nak('status 0x%02x' % rsp[0])
        if rsp[0] == 0x05 and echoes:
            raise Asleep('status 0x05')
        if rsp[0] == 0x02 and echoes:
            saw_pending = True
        if time.monotonic() >= deadline:
            if saw_pending:
                raise Asleep('pending never resolved')
            raise Timeout('last=' + hx(last, 12))
        time.sleep(0.01)


def rd(dev, cat, reg, sub, prof=0, pl=()):
    return transact(dev, build(cat, reg | 0x80, sub, prof, pl))


def wr(dev, cat, reg, sub, prof=0, pl=()):
    r = transact(dev, build(cat, reg, sub, prof, pl))
    time.sleep(0.12)
    return r


results = []


def rec(name, ok, detail, **extra):
    results.append({'name': name, 'ok': ok, 'detail': detail, **extra})
    print('%s %-34s %s' % ('OK  ' if ok else 'FAIL', name, detail), flush=True)


def check(name, fn):
    try:
        fn()
    except Asleep as e:
        rec(name, False, 'mouse asleep (%s)' % e)
        raise
    except Exception as e:
        rec(name, False, '%s: %s' % (type(e).__name__, e))


def main():
    paths = [d['path'] for d in hid.enumerate(VID, PID) if d['interface_number'] == IFACE and d['usage_page'] == 0xFFFF]
    if not paths:
        print('dongle 3710:5402 interface %d not found' % IFACE)
        sys.exit(2)
    dev = hid.device()
    dev.open_path(paths[0])
    try:
        awake = False
        for i in range(30):
            try:
                rd(dev, 0x08, 0x01, 0x01)
                awake = True
                break
            except Asleep:
                if i == 0:
                    print('mouse is asleep: move it to wake it (waiting up to 60 s)...', flush=True)
                time.sleep(2)
            except Timeout as e:
                print('timeout', e)
                time.sleep(1)
        if not awake:
            print('mouse never woke up; nothing validated')
            sys.exit(3)

        def identity():
            r = rd(dev, 0x01, 0x04, 0x04)
            vid, pid = struct.unpack_from('<HH', r, 6)
            rec('paired mouse 01 04 04', vid == 0x3710 and pid in (0x3409, 0x3410), '%04x:%04x' % (vid, pid), raw=hx(r, 12))
            r = rd(dev, 0x01, 0x07, 0x04)
            fw = '%d.%d.%x' % (r[7] >> 4, r[7] & 0xf, r[6])
            rec('firmware 01 07 04', fw == '1.0.16', fw, raw=hx(r, 12))
        check('identity', identity)

        def power():
            b = rd(dev, 0x08, 0x01, 0x01)
            c = rd(dev, 0x08, 0x03, 0x01)
            rec('battery 08 01 01', 0 <= b[6] <= 100, '%d %%' % b[6], raw=hx(b, 10))
            rec('charging 08 03 01', c[6] in (0, 1), str(c[6]), raw=hx(c, 10))
        check('power', power)

        def u16_rw(name, cat, reg, sub, off, new_of, prof=0, pre=()):
            r = rd(dev, cat, reg, sub, prof)
            orig = struct.unpack_from('<H', r, off)[0]
            new = new_of(orig)
            wr(dev, cat, reg, sub, prof, list(pre) + list(struct.pack('<H', new)))
            got = struct.unpack_from('<H', rd(dev, cat, reg, sub, prof), off)[0]
            wr(dev, cat, reg, sub, prof, list(pre) + list(struct.pack('<H', orig)))
            back = struct.unpack_from('<H', rd(dev, cat, reg, sub, prof), off)[0]
            rec(name, got == new and back == orig, '%d -> %d (wanted %d) -> restored %d' % (orig, got, new, back), raw=hx(r, 12))

        def u8_rw(name, cat, reg, sub, off, new_of, prof=0, pre=(), fmt=str):
            r = rd(dev, cat, reg, sub, prof)
            orig = r[off]
            new = new_of(orig)
            wr(dev, cat, reg, sub, prof, list(pre) + [new])
            got = rd(dev, cat, reg, sub, prof)[off]
            wr(dev, cat, reg, sub, prof, list(pre) + [orig])
            back = rd(dev, cat, reg, sub, prof)[off]
            rec(name, got == new and back == orig, '%s -> %s (wanted %s) -> restored %s' % (fmt(orig), fmt(got), fmt(new), fmt(back)), raw=hx(r, 12))

        pct = lambda v: '%d %%' % v
        ms_ = lambda v: '%d ms' % v
        mm = lambda v: '%.1f mm' % (v / 10)
        onoff = lambda v: 'on' if v else 'off'

        check('sleep timer', lambda: u16_rw('sleep timer 08 05 03', 0x08, 0x05, 0x03, 7, lambda o: 60 if o != 60 else 120))
        check('low power', lambda: u8_rw('low power 08 08 02', 0x08, 0x08, 0x02, 7, lambda o: o + 5 if o <= 90 else o - 5, fmt=pct))
        check('polling', lambda: u8_rw('polling 01 09 02', 0x01, 0x09, 0x02, 7, lambda o: 0x04 if o != 0x04 else 0x08, fmt=hex))
        check('debounce', lambda: u8_rw('debounce 04 03 03', 0x04, 0x03, 0x03, 7, lambda o: o + 1 if o < 20 else o - 1, fmt=ms_))
        check('lod', lambda: u8_rw('lod 07 02 03 (profile 1)', 0x07, 0x02, 0x03, 8, lambda o: 20 if o != 20 else 10, prof=1, pre=(0x02,), fmt=mm))

        def lod_p0():
            p1 = rd(dev, 0x07, 0x02, 0x03, 1)[8]
            p0 = rd(dev, 0x07, 0x02, 0x03, 0)[8]
            rec('lod profile 0 read mirrors profile 1', p0 == p1, 'p0=%d p1=%d' % (p0, p1))
        check('lod p0', lod_p0)

        for reg, name in ((0x03, 'ripple'), (0x04, 'angle snap'), (0x05, 'motion sync')):
            check(name, lambda reg=reg, name=name: u8_rw('%s 07 %02x 02' % (name, reg), 0x07, reg, 0x02, 7, lambda o: 0 if o else 1, fmt=onoff))

        def dpi():
            r = rd(dev, 0x05, 0x04, 0x15, 1)
            active, n = r[7], r[8]
            stages = [(struct.unpack_from('<H', r, 9 + i * 5 + 1)[0], struct.unpack_from('<H', r, 9 + i * 5 + 3)[0]) for i in range(n)]
            idx_ok = all(r[9 + i * 5] == i + 1 for i in range(n))
            rec('dpi stages 05 04 15 read', 1 <= n <= 6 and 1 <= active <= n and idx_ok, 'active %d, %d stages %s, answered sub 0x%02x' % (active, n, stages, r[3]), raw=hx(r, 40))
            a = rd(dev, 0x05, 0x01, 0x02, 1)
            cur = rd(dev, 0x05, 0x02, 0x05)
            cx, cy = struct.unpack_from('<HH', cur, 7)
            rec('active stage 05 01 02 read', a[7] == active, '%d (table says %d)' % (a[7], active), raw=hx(a, 10))
            rec('current dpi 05 02 05 read', (cx, cy) == stages[active - 1], '%dx%d (stage %d = %s)' % (cx, cy, active, stages[active - 1]), raw=hx(cur, 12))

            def payload(st, act):
                p = [act, len(st)]
                for i, (x, y) in enumerate(st):
                    p += [i + 1] + list(struct.pack('<H', x)) + list(struct.pack('<H', y))
                return p

            wr(dev, 0x05, 0x04, 0x21, 1, payload(stages, active))
            r2 = rd(dev, 0x05, 0x04, 0x15, 1)
            same = r2[7:9 + n * 5] == r[7:9 + n * 5]
            rec('dpi stages 05 04 21 idempotent write', same, 'table unchanged' if same else 'changed: ' + hx(r2, 40))

            changed = list(stages)
            x, y = changed[active - 1]
            changed[active - 1] = (x + 10, y + 10)
            wr(dev, 0x05, 0x04, 0x21, 1, payload(changed, active))
            r3 = rd(dev, 0x05, 0x04, 0x15, 1)
            got = [(struct.unpack_from('<H', r3, 9 + i * 5 + 1)[0], struct.unpack_from('<H', r3, 9 + i * 5 + 3)[0]) for i in range(r3[8])]
            c3 = struct.unpack_from('<HH', rd(dev, 0x05, 0x02, 0x05), 7)
            rec('dpi stages 05 04 21 write', got == changed and c3 == changed[active - 1], '%s -> %s; current dpi %s' % (stages, got, c3))
            wr(dev, 0x05, 0x04, 0x21, 1, payload(stages, active))
            r4 = rd(dev, 0x05, 0x04, 0x15, 1)
            rec('dpi stages restored', r4[7:9 + n * 5] == r[7:9 + n * 5], hx(r4, 9 + n * 5))

            if n > 1:
                other = 1 if active != 1 else 2
                wr(dev, 0x05, 0x01, 0x02, 1, [other])
                a2 = rd(dev, 0x05, 0x01, 0x02, 1)[7]
                cur2 = struct.unpack_from('<HH', rd(dev, 0x05, 0x02, 0x05), 7)
                tbl = rd(dev, 0x05, 0x04, 0x15, 1)[7]
                wr(dev, 0x05, 0x01, 0x02, 1, [active])
                a3 = rd(dev, 0x05, 0x01, 0x02, 1)[7]
                rec('active stage 05 01 02 write', a2 == other and cur2 == stages[other - 1] and tbl == other and a3 == active,
                    '%d -> %d (current %s, table byte7 %d) -> restored %d' % (active, a2, cur2, tbl, a3))
        check('dpi', dpi)

        def buttons():
            ids = [0x01, 0x02, 0x03, 0x04, 0x05, 0x0b]
            cur = {}
            for i in ids:
                r = rd(dev, 0x04, 0x01, 0x06, 1, [i, 0xff])
                cur[i] = (r[8], r[9], r[10])
                rec('button 0x%02x read' % i, r[7] == i, 'type/a1/a2 = %02x %02x %02x' % cur[i], raw=hx(r, 12))
            t, a1, a2 = cur[0x0b]
            wr(dev, 0x04, 0x01, 0x06, 1, [0x0b, t, a1, a2])
            r = rd(dev, 0x04, 0x01, 0x06, 1, [0x0b, 0xff])
            rec('button 0x0b idempotent write', (r[8], r[9], r[10]) == cur[0x0b], hx(r, 12))
            wr(dev, 0x04, 0x01, 0x06, 1, [0x0b, 0x09, 0x01, 0x00])
            r = rd(dev, 0x04, 0x01, 0x06, 1, [0x0b, 0xff])
            got = (r[8], r[9], r[10])
            wr(dev, 0x04, 0x01, 0x06, 1, [0x0b, t, a1, a2])
            r = rd(dev, 0x04, 0x01, 0x06, 1, [0x0b, 0xff])
            back = (r[8], r[9], r[10])
            rec('button 0x0b write 04 01 06', got == (0x09, 0x01, 0x00) and back == cur[0x0b], '%s -> %s -> restored %s' % (cur[0x0b], got, back))
            t, a1, a2 = cur[0x05]
            wr(dev, 0x04, 0x01, 0x06, 1, [0x05, 0x02, 0x01, 0x06])
            r = rd(dev, 0x04, 0x01, 0x06, 1, [0x05, 0xff])
            got = (r[8], r[9], r[10])
            wr(dev, 0x04, 0x01, 0x06, 1, [0x05, t, a1, a2])
            r = rd(dev, 0x04, 0x01, 0x06, 1, [0x05, 0xff])
            back = (r[8], r[9], r[10])
            rec('button 0x05 keyboard write', got == (0x02, 0x01, 0x06) and back == cur[0x05], '%s -> %s -> restored %s' % (cur[0x05], got, back))
        check('buttons', buttons)

        def info():
            for cat, reg, sub, prof, pl, name in (
                (0x05, 0x05, 0x05, 1, (1,), 'stage colour 05 05 05 [1]'),
                (0x01, 0x01, 0x01, 0, (), 'unknown 01 01 01'),
                (0x01, 0x05, 0x02, 0, (), 'unknown 01 05 02'),
                (0x01, 0x06, 0x02, 0, (), 'unknown 01 06 02'),
                (0x01, 0x08, 0x04, 0, (), 'unknown 01 08 04'),
                (0x08, 0x02, 0x01, 0, (), 'unknown 08 02 01'),
                (0x08, 0x04, 0x02, 0, (), 'unknown 08 04 02'),
            ):
                try:
                    r = rd(dev, cat, reg, sub, prof, pl)
                    rec(name, True, hx(r, 14), raw=hx(r, 14), info=True)
                except (Nak, Timeout) as e:
                    rec(name, True, 'no answer: %s' % e, info=True)
        check('info', info)

    except Asleep:
        print('\nmouse fell asleep mid-run; results above are partial')
    finally:
        dev.close()
        ms = stats['ms']
        summary = {
            'transactions': stats['tx'], 'checksum_bad': stats['checksum_bad'], 'sub_mismatch': stats['sub_mismatch'],
            'rt_ms_min': round(min(ms), 1) if ms else None,
            'rt_ms_med': round(sorted(ms)[len(ms) // 2], 1) if ms else None,
            'rt_ms_max': round(max(ms), 1) if ms else None,
            'passed': sum(1 for r in results if r['ok'] and not r.get('info')),
            'failed': sum(1 for r in results if not r['ok']),
        }
        print('\nsummary:', json.dumps(summary))
        with open(OUT, 'w') as f:
            json.dump({'summary': summary, 'results': results, 'when': time.strftime('%Y-%m-%d %H:%M:%S')}, f, indent=1)


if __name__ == '__main__':
    main()
