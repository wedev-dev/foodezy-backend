// สร้าง payload มาตรฐาน EMVCo สำหรับ PromptPay QR (ฝังยอดเงิน) — ไม่พึ่ง library ภายนอก
// อ้างอิงสเปกเดียวกับ promptpay-qr: รองรับเบอร์มือถือ / เลขบัตร ปชช. / e-Wallet id

function tlv(id: string, value: string): string {
  const len = value.length.toString().padStart(2, '0');
  return `${id}${len}${value}`;
}

function crc16(data: string): string {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i += 1) {
    crc ^= data.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j += 1) {
      crc = (crc & 0x8000) !== 0 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** คืน payload string สำหรับเรนเดอร์เป็น QR — target = promptpay number (เบอร์/บัตร ปชช.) */
export function promptpayPayload(target: string, amount?: number): string {
  const sanitized = (target || '').replace(/[^0-9]/g, '');
  if (!sanitized) return '';

  // ประเภทเป้าหมายตามความยาว: >=15 e-wallet(03), >=13 บัตร ปชช.(02), อื่น ๆ เบอร์มือถือ(01)
  const type = sanitized.length >= 15 ? '03' : sanitized.length >= 13 ? '02' : '01';
  const acc =
    type === '01'
      ? `0000000000000${sanitized.replace(/^0/, '66')}`.slice(-13)
      : sanitized;

  const merchant = tlv('00', 'A000000677010111') + tlv(type, acc);
  const hasAmount = typeof amount === 'number' && amount > 0;

  let payload =
    tlv('00', '01') +
    tlv('01', hasAmount ? '12' : '11') +
    tlv('29', merchant) +
    tlv('58', 'TH') +
    tlv('53', '764') +
    (hasAmount ? tlv('54', amount.toFixed(2)) : '');

  payload += '6304';
  payload += crc16(payload);
  return payload;
}
