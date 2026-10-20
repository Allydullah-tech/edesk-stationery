// Dashboard motion helpers (cosmetic). Loaded before dashboard.js.
//  - shows a shimmer placeholder on the stat figures while data loads
//  - counts the figures up from zero once the data has arrived
(function () {
    var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function values() { return document.querySelectorAll('.stat-card .value'); }

    // 1) loading placeholders (removed by animateStatValues / stopStatSkeleton)
    values().forEach(function (el) { el.classList.add('skeleton'); });

    window.stopStatSkeleton = function () {
        values().forEach(function (el) { el.classList.remove('skeleton'); });
    };

    // 2) count-up: keeps any prefix ("TZS ") and suffix, animates the number
    function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

    window.animateStatValues = function () {
        values().forEach(function (el, i) {
            el.classList.remove('skeleton');
            var text = (el.textContent || '').trim();
            var m = text.match(/^([^\d-]*)(-?[\d,]+(?:\.\d+)?)(.*)$/);
            if (!m || REDUCED) return;
            var prefix = m[1], suffix = m[3];
            var target = parseFloat(m[2].replace(/,/g, ''));
            if (!isFinite(target) || target === 0) return;

            var duration = 1000, delay = 150 + i * 70, start = null;
            el.textContent = prefix + '0' + suffix;
            function frame(ts) {
                if (start === null) start = ts;
                var t = Math.min(1, (ts - start) / duration);
                var v = Math.round(target * easeOutCubic(t));
                el.textContent = prefix + v.toLocaleString('en-US') + suffix;
                if (t < 1) requestAnimationFrame(frame);
                else { el.textContent = text; el.classList.add('counted'); }
            }
            setTimeout(function () { requestAnimationFrame(frame); }, delay);
        });
    };
})();

// ---------------------------------------------------------------------
// Welcome banner: greeting by time of day, first name, live date + clock,
// and a few drifting gold specks. Called by dashboard.js after login check.
// ---------------------------------------------------------------------
(function () {
    var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var MONTHS = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];
    var DAYS = ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'];
    var timer = null;

    function pad(n) { return n < 10 ? '0' + n : '' + n; }
    function $(id) { return document.getElementById(id); }

    function greeting(h) {
        return h < 12 ? 'Good morning' : (h < 17 ? 'Good afternoon' : 'Good evening');
    }

    function tick(firstName) {
        var d = new Date();
        $('heroGreeting').textContent = greeting(d.getHours()) + ', ' + firstName + ' \u00B7 Welcome back';
        $('heroWeekday').textContent = DAYS[d.getDay()];
        $('heroDay').textContent = d.getDate();
        $('heroMonth').textContent = MONTHS[d.getMonth()] + ' ' + d.getFullYear();
        $('heroTime').textContent = pad(d.getHours()) + ':' + pad(d.getMinutes());
        $('heroSecs').textContent = pad(d.getSeconds());
    }

    function particles() {
        var box = $('heroParticles');
        if (!box || REDUCED) return;
        for (var i = 0; i < 14; i++) {
            var p = document.createElement('i');
            p.style.left = (Math.random() * 100) + '%';
            p.style.animationDuration = (6 + Math.random() * 7) + 's';
            p.style.animationDelay = (-Math.random() * 10) + 's';
            var sz = 5 + Math.random() * 6;
            p.style.width = sz + 'px';
            p.style.height = (sz * 0.62) + 'px';
            box.appendChild(p);
        }
    }

    window.initDashHero = function (user) {
        if (!$('dashHero')) return;
        var full = (user && user.full_name) ? String(user.full_name).trim() : '';
        var first = full ? full.split(/\s+/)[0] : 'there';
        $('heroName').textContent = first;
        tick(first);
        if (timer) clearInterval(timer);
        timer = setInterval(function () { tick(first); }, 1000);
        particles();
    };
})();
