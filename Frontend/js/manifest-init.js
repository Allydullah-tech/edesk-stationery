(function() {
    // Base folder of the current page (e.g. https://site.com/Frontend/)
    var base = document.baseURI.replace(/[^/]*$/, '');

    var manifest = {
        name: 'eDESK Print & Digital - Business Manager',
        short_name: 'eDESK',
        description: 'Track stock, sales, expenses, damages and reports for eDESK - Print & Digital.',
        start_url: base + 'index.html',
        scope: base,
        display: 'standalone',
        background_color: '#101B30',
        theme_color: '#101B30',
        orientation: 'portrait-primary',
        icons: [
            { src: base + 'assets/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: base + 'assets/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: base + 'assets/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
    };

    try {
        var blob = new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' });
        var url = URL.createObjectURL(blob);
        var link = document.createElement('link');
        link.rel = 'manifest';
        link.href = url;
        document.head.appendChild(link);
    } catch (e) {
        // Fallback: if Blob creation somehow fails, still try the static file.
        var fallback = document.createElement('link');
        fallback.rel = 'manifest';
        fallback.href = 'manifest.json';
        document.head.appendChild(fallback);
    }
})();