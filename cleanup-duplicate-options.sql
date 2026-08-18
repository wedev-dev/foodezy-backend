-- ========================================================
-- ล้างกลุ่มออฟชั่นที่ซ้ำ (ดึงจากคลังกลางซ้ำ) — เก็บตัวแรก ลบที่เหลือ
-- รันใน phpMyAdmin > แท็บ SQL ทีเดียวได้เลย (เรียงตามลำดับ)
-- ปลอดภัย: ลบเฉพาะกลุ่มที่มาจากคลังกลาง (source_global_group_id != NULL) ที่ซ้ำ
-- ========================================================

-- 1) ลบกลุ่มที่ซ้ำ (เก็บ id น้อยสุดของแต่ละร้าน+ต้นแบบ)
DELETE g FROM shop_option_groups g
WHERE g.source_global_group_id IS NOT NULL
  AND g.id NOT IN (
    SELECT keep_id FROM (
      SELECT MIN(id) AS keep_id
        FROM shop_option_groups
       WHERE source_global_group_id IS NOT NULL
       GROUP BY shop_id, source_global_group_id
    ) AS k
  );

-- 2) ลบตัวเลือกย่อยที่ไม่มีกลุ่มแม่แล้ว (orphan)
DELETE i FROM shop_option_items i
LEFT JOIN shop_option_groups g ON g.id = i.shop_option_group_id
WHERE g.id IS NULL;

-- 3) ลบการผูกเมนู-กลุ่ม ที่กลุ่มถูกลบไปแล้ว (orphan)
DELETE l FROM menu_option_groups l
LEFT JOIN shop_option_groups g ON g.id = l.shop_option_group_id
WHERE g.id IS NULL;
