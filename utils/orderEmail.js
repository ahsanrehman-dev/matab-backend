import { isEmailConfigured, sendTransactionalEmail } from './emailService.js';

const PAYMENT_LABELS = {
  cash_on_delivery: 'Cash on Delivery',
  credit_card: 'Credit Card',
  bank_transfer: 'Bank Transfer',
  wallet: 'Wallet',
};

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const formatPKR = (value) =>
  `Rs ${Number(value || 0).toLocaleString('en-PK')}`;

const getAdminEmail = () =>
  (process.env.ADMIN_EMAIL || process.env.EMAIL_USER || '').trim();

const getCustomerName = (shippingAddress = {}) =>
  `${shippingAddress.firstName || ''} ${shippingAddress.lastName || ''}`.trim() || 'Customer';

const getProductName = (item) =>
  item?.product?.name || item?.name || 'Product';

const formatOrderDate = (date) => {
  if (!date) return '—';
  return new Date(date).toLocaleString('en-PK', {
    timeZone: 'Asia/Karachi',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
};

const buildOrderItems = (order) =>
  (order.items || []).map((item) => {
    const quantity = Number(item.quantity || 1);
    const price = Number(item.price ?? item.product?.price ?? 0);
    const lineTotal = Number(item.total ?? price * quantity);
    return {
      name: getProductName(item),
      quantity,
      price,
      lineTotal,
    };
  });

const buildPlainText = (order, items) => {
  const ship = order.shippingAddress || {};
  const itemLines = items
    .map(
      (item, index) =>
        `${index + 1}. ${item.name} x${item.quantity} — ${formatPKR(item.lineTotal)}`
    )
    .join('\n');

  return [
    'New order received on Matab',
    '',
    `Order number: ${order.orderNumber || order._id}`,
    `Placed: ${formatOrderDate(order.createdAt)}`,
    `Status: ${order.status || 'pending'}`,
    `Payment: ${PAYMENT_LABELS[order.paymentMethod] || order.paymentMethod || 'Cash on Delivery'}`,
    `Customer type: ${order.isGuest ? 'Guest' : 'Registered'}`,
    '',
    'Customer',
    `Name: ${getCustomerName(ship)}`,
    `Email: ${ship.email || '—'}`,
    `Phone: ${ship.phone || '—'}`,
    '',
    'Shipping address',
    ship.street || '—',
    [ship.city, ship.state, ship.zipCode].filter(Boolean).join(', '),
    ship.country || 'Pakistan',
    '',
    'Items',
    itemLines || '—',
    '',
    `Subtotal: ${formatPKR(order.subtotal)}`,
    `Shipping: ${order.shippingCost === 0 ? 'FREE' : formatPKR(order.shippingCost)}`,
    `Tax: ${formatPKR(order.tax)}`,
    `Total: ${formatPKR(order.total)}`,
    '',
    `Notes: ${order.notes || 'None'}`,
  ].join('\n');
};

const buildHtml = (order, items) => {
  const ship = order.shippingAddress || {};
  const itemRows = items
    .map(
      (item) => `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#111827;">${escapeHtml(item.name)}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:center;color:#374151;">${item.quantity}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;color:#374151;">${escapeHtml(formatPKR(item.price))}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:600;color:#111827;">${escapeHtml(formatPKR(item.lineTotal))}</td>
        </tr>`
    )
    .join('');

  return `
    <!DOCTYPE html>
    <html>
      <body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif;">
        <div style="max-width:640px;margin:24px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 8px 24px rgba(15,23,42,0.08);">
          <div style="background:linear-gradient(135deg,#2563eb 0%,#4f46e5 100%);padding:28px 24px;color:#ffffff;">
            <h1 style="margin:0 0 8px;font-size:24px;">New order received</h1>
            <p style="margin:0;opacity:0.9;">A customer has placed an order on Matab.</p>
          </div>
          <div style="padding:24px;">
            <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
              <tr>
                <td style="padding:6px 0;color:#6b7280;">Order number</td>
                <td style="padding:6px 0;text-align:right;font-weight:700;color:#111827;">#${escapeHtml(order.orderNumber || String(order._id || '').slice(-8))}</td>
              </tr>
              <tr>
                <td style="padding:6px 0;color:#6b7280;">Placed</td>
                <td style="padding:6px 0;text-align:right;color:#111827;">${escapeHtml(formatOrderDate(order.createdAt))}</td>
              </tr>
              <tr>
                <td style="padding:6px 0;color:#6b7280;">Status</td>
                <td style="padding:6px 0;text-align:right;color:#111827;">${escapeHtml(order.status || 'pending')}</td>
              </tr>
              <tr>
                <td style="padding:6px 0;color:#6b7280;">Payment</td>
                <td style="padding:6px 0;text-align:right;color:#111827;">${escapeHtml(PAYMENT_LABELS[order.paymentMethod] || order.paymentMethod || 'Cash on Delivery')}</td>
              </tr>
              <tr>
                <td style="padding:6px 0;color:#6b7280;">Customer type</td>
                <td style="padding:6px 0;text-align:right;color:#111827;">${order.isGuest ? 'Guest' : 'Registered'}</td>
              </tr>
            </table>

            <h2 style="margin:0 0 10px;font-size:16px;color:#111827;">Customer</h2>
            <p style="margin:0 0 16px;line-height:1.6;color:#374151;">
              <strong>${escapeHtml(getCustomerName(ship))}</strong><br />
              Email: ${escapeHtml(ship.email || '—')}<br />
              Phone: ${escapeHtml(ship.phone || '—')}
            </p>

            <h2 style="margin:0 0 10px;font-size:16px;color:#111827;">Shipping address</h2>
            <p style="margin:0 0 20px;line-height:1.6;color:#374151;">
              ${escapeHtml(ship.street || '—')}<br />
              ${escapeHtml([ship.city, ship.state, ship.zipCode].filter(Boolean).join(', '))}<br />
              ${escapeHtml(ship.country || 'Pakistan')}
            </p>

            <h2 style="margin:0 0 10px;font-size:16px;color:#111827;">Items</h2>
            <table style="width:100%;border-collapse:collapse;margin-bottom:20px;background:#f9fafb;border-radius:8px;overflow:hidden;">
              <thead>
                <tr style="background:#eef2ff;">
                  <th style="padding:10px 12px;text-align:left;color:#374151;font-size:12px;">Product</th>
                  <th style="padding:10px 12px;text-align:center;color:#374151;font-size:12px;">Qty</th>
                  <th style="padding:10px 12px;text-align:right;color:#374151;font-size:12px;">Price</th>
                  <th style="padding:10px 12px;text-align:right;color:#374151;font-size:12px;">Total</th>
                </tr>
              </thead>
              <tbody>
                ${itemRows}
              </tbody>
            </table>

            <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
              <tr>
                <td style="padding:6px 0;color:#6b7280;">Subtotal</td>
                <td style="padding:6px 0;text-align:right;color:#111827;">${escapeHtml(formatPKR(order.subtotal))}</td>
              </tr>
              <tr>
                <td style="padding:6px 0;color:#6b7280;">Shipping</td>
                <td style="padding:6px 0;text-align:right;color:#111827;">${order.shippingCost === 0 ? 'FREE' : escapeHtml(formatPKR(order.shippingCost))}</td>
              </tr>
              <tr>
                <td style="padding:6px 0;color:#6b7280;">Tax</td>
                <td style="padding:6px 0;text-align:right;color:#111827;">${escapeHtml(formatPKR(order.tax))}</td>
              </tr>
              <tr>
                <td style="padding:10px 0 0;border-top:2px solid #e5e7eb;font-weight:700;color:#111827;">Total</td>
                <td style="padding:10px 0 0;border-top:2px solid #e5e7eb;text-align:right;font-weight:700;color:#111827;">${escapeHtml(formatPKR(order.total))}</td>
              </tr>
            </table>

            <p style="margin:0;color:#374151;"><strong>Notes:</strong> ${escapeHtml(order.notes || 'None')}</p>
          </div>
          <div style="padding:16px 24px;background:#f9fafb;color:#9ca3af;font-size:12px;text-align:center;">
            This is an automated Matab order notification. Do not reply to this email.
          </div>
        </div>
      </body>
    </html>
  `;
};

export const sendAdminOrderNotification = async (order) => {
  if (!order?._id) {
    console.warn('⚠️ Admin order email skipped: order is missing');
    return { success: false, skipped: true };
  }

  if (!isEmailConfigured()) {
    console.warn('⚠️ Admin order email skipped: email is not configured');
    return { success: false, skipped: true };
  }

  const adminEmail = getAdminEmail();
  if (!adminEmail) {
    console.warn('⚠️ Admin order email skipped: ADMIN_EMAIL is not set');
    return { success: false, skipped: true };
  }

  const items = buildOrderItems(order);
  const orderRef = order.orderNumber || String(order._id).slice(-8);

  try {
    const info = await sendTransactionalEmail({
      to: adminEmail,
      subject: `New Matab order #${orderRef} — ${formatPKR(order.total)}`,
      html: buildHtml(order, items),
      text: buildPlainText(order, items),
    });

    console.log('✅ Admin order email sent:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('❌ Admin order email failed:', error.message || error);
    return { success: false, error: error.message || 'Failed to send admin order email' };
  }
};
