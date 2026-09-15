(async function init() {
    await requireAuth();

    const params = new URLSearchParams(window.location.search);
    const saleId = params.get('id');

    if (!saleId) {
        document.getElementById('receiptContent').innerHTML =
            '<div class="not-found">No sale specified.</div>';
        return;
    }

    const res = await API.get('sales.php', { id: saleId });

    if (!res.success) {
        document.getElementById('receiptContent').innerHTML =
            `<div class="not-found">${res.message}</div>`;
        return;
    }

    renderReceipt(res.data);
})();


function renderReceipt(s) {

    const receiptNo = 'EDK-' + String(s.id).padStart(6, '0');

    const saleDate = new Date(
        (s.sale_date || '') + 'T00:00:00'
    );

    const createdAt = s.created_at ?
        new Date(s.created_at.replace(' ', 'T')) :
        saleDate;


    /* Payment method */
    let paymentLine = 'Cash';

    if (s.payment_method === 'credit') {
        paymentLine = 'Credit';
    } else if (s.cash_type === 'online') {
        paymentLine = 'Cash (' + (s.online_method || 'Online') + ')';
    }


    /* Items */
    const itemsHtml = s.items.map((item, i) => `
        <div class="item-row">

            <div class="item-name">
                ${i + 1}. ${item.product_name}
            </div>

            <div class="row">
                <span class="k">
                    ${item.quantity} ${item.unit || ''} x ${money(item.unit_price)}
                </span>

                <span>
                    ${money(item.subtotal)}
                </span>
            </div>

        </div>
    `).join('');


    /* Customer information */
    const customerBlock =
        (s.customer_name || s.customer_phone) ? `

        <hr>

        <div class="row">
            <span class="k">Customer</span>
            <span>${s.customer_name || '—'}</span>
        </div>

        ${s.customer_phone ? `
            <div class="row">
                <span class="k">Phone</span>
                <span>${s.customer_phone}</span>
            </div>
        ` : ''}

        ${s.payment_method === 'credit' && s.credit_deadline ? `
            <div class="row">
                <span class="k">Pay by</span>
                <span>${fmtDate(s.credit_deadline)}</span>
            </div>
        ` : ''}

    ` : '';


    /* Receipt */
    document.getElementById('receiptContent').innerHTML = `

        <div class="receipt-paper">

            <!-- SHOP HEADER -->
            <div class="center">

                <img
                    src="assets/logo1.png"
                    alt="eDESK Logo"
                    class="logo"
                >

                <div class="shop-tagline">
                    Print. Create. Design.
                </div>

                <div class="shop-meta">
                    Mbeya, Iyunga (Moja One)<br>
                    +255 763 399 399
                </div>

            </div>


            <!-- RECEIPT INFORMATION -->
            <hr>

            <div class="row">
                <span class="k">Receipt No.</span>
                <span class="receipt-id">
                    ${receiptNo}
                </span>
            </div>

            <div class="row">
                <span class="k">Date</span>
                <span>
                    ${saleDate.toLocaleDateString('en-GB')}
                </span>
            </div>

            <div class="row">
                <span class="k">Time</span>
                <span>
                    ${createdAt.toLocaleTimeString('en-GB', {
                        hour: '2-digit',
                        minute: '2-digit'
                    })}
                </span>
            </div>

            <div class="row">
                <span class="k">Served by</span>
                <span>
                    ${s.sold_by_name}
                </span>
            </div>


            <!-- ITEMS -->
            <hr>

            ${itemsHtml}


            <!-- TOTALS -->
            <div class="totals">

                <div class="row grand-total">
                    <span>TOTAL</span>
                    <span>
                        ${money(s.total_amount)}
                    </span>
                </div>

                <div class="row">
                    <span class="k">Payment</span>
                    <span>
                        ${paymentLine}
                    </span>
                </div>

                ${
                    s.payment_method === 'credit'
                    ? `
                        <div class="row">
                            <span class="k">Status</span>
                            <span>
                                ${money(s.total_amount)} DUE
                            </span>
                        </div>
                    `
                    : `
                        <div class="row">
                            <span class="k">Status</span>
                            <span>PAID</span>
                        </div>
                    `
                }

            </div>


            <!-- CUSTOMER -->
            ${customerBlock}


            <!-- FOOTER -->
            <hr>

            <div class="footer-note">
                Thank you for your business!<br>
                Goods once sold are not returnable without this receipt.
            </div>

        </div>
    `;
}