// Pins the clock the database tests see (and so the test database's now()) to a fixed India-time
// hour today, so results don't depend on when they run (push quiet hours, "today", midnight).
// EITHR_TEST_IST_HOUR picks the hour (default 15, mid-afternoon); "real" leaves the clock alone.
const hour = process.env.EITHR_TEST_IST_HOUR ?? '15';
if (hour !== 'real') {
  const real = Date.now.bind(Date);
  const IST = 330 * 60000;
  const ist = new Date(real() + IST);
  const target = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), Number(hour)) - IST;
  const off = target - real();
  const RealDate = Date;
  Date.now = () => real() + off;
  globalThis.Date = class extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(real() + off); }
    static now() { return real() + off; }
  };
}
