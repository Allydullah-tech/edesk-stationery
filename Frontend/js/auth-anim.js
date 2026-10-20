// Cosmetic motion for login.html / forgot-password.html:
// the logo rings and background layers react slightly to the pointer,
// and a soft gold light follows the cursor.
(function () {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    var wrap = document.querySelector('.auth-wrap');
    if (!wrap) return;
    var rings = document.querySelectorAll('.logo-ring');
    var layer = document.querySelector('.auth-icons');
    var spot = document.querySelector('.auth-spot');
    if (layer) layer.style.transition = 'transform .5s ease-out';

    var raf = null;
    wrap.addEventListener('mousemove', function (e) {
        if (raf) return;
        raf = requestAnimationFrame(function () {
            raf = null;
            var r = wrap.getBoundingClientRect();
            var x = (e.clientX - r.left) / r.width - 0.5;
            var y = (e.clientY - r.top) / r.height - 0.5;
            rings.forEach(function (el) {
                el.style.setProperty('--mx', x.toFixed(3));
                el.style.setProperty('--my', y.toFixed(3));
            });
            if (layer) layer.style.transform = 'translate(' + (x * -26).toFixed(1) + 'px,' + (y * -26).toFixed(1) + 'px)';
            if (spot) {
                spot.style.setProperty('--cx', (e.clientX - r.left) + 'px');
                spot.style.setProperty('--cy', (e.clientY - r.top) + 'px');
            }
        });
    });
    wrap.addEventListener('mouseleave', function () {
        rings.forEach(function (el) { el.style.setProperty('--mx', 0); el.style.setProperty('--my', 0); });
        if (layer) layer.style.transform = '';
    });
})();
