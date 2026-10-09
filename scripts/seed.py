"""Seed 24 realistic SKUs into the Till0 products table.

EAN-13 barcodes are computed programmatically (never hand-written).
Each barcode uses the GS1 company prefix 8901234 (12 digits + computed check digit).
"""

from __future__ import annotations

import os

import psycopg


def ean13_check_digit(first_12: str) -> str:
    """Compute the EAN-13 check digit for a 12-digit string.

    Algorithm:
      1. Sum odd-position digits (1-indexed) × 1 and even-position digits × 3.
      2. Check digit = (10 - (sum mod 10)) mod 10
    """
    if len(first_12) != 12 or not first_12.isdigit():
        raise ValueError(f"Expected 12 numeric characters, got {first_12!r}")
    total = 0
    for i, ch in enumerate(first_12):
        weight = 1 if i % 2 == 0 else 3
        total += int(ch) * weight
    return str((10 - (total % 10)) % 10)


def make_ean13(sequence: int) -> str:
    """Generate an EAN-13 from a sequence number (0-based).

    Uses the prefix 8901234 (7 digits) + 5-digit sequence zero-padded.
    """
    prefix = "8901234"
    body = f"{sequence:05d}"
    first12 = prefix + body
    check = ean13_check_digit(first12)
    full = first12 + check
    assert len(full) == 13, f"EAN-13 must be 13 digits, got {len(full)}"
    return full


# 24 realistic Indian grocery / FMCG products
# (name, price_paise, tax_bp, opening_stock)
PRODUCTS: list[tuple[str, int, int, int]] = [
    # Staples
    ("Aashirvaad Atta 5kg", 28900, 0, 120),
    ("Fortune Soyabean Oil 1L", 13500, 500, 80),
    ("India Gate Basmati Rice 1kg", 11900, 0, 100),
    ("Tata Salt 1kg", 2200, 0, 200),
    ("MDH Rajma Masala 100g", 7500, 1800, 60),
    # Beverages
    ("Bru Instant Coffee 200g", 34900, 1200, 40),
    ("Tata Tea Gold 500g", 24900, 500, 55),
    ("Minute Maid Orange 1L", 7900, 1200, 90),
    ("Nescafe Classic 50g", 19900, 1200, 35),
    # Personal care
    ("Colgate MaxFresh 150g", 8900, 1800, 75),
    ("Dove Soap Bar 100g", 4900, 1800, 110),
    ("Clinic Plus Shampoo 175ml", 9900, 1800, 65),
    # Snacks
    ("Lay's Classic Salted 26g", 2000, 1200, 150),
    ("Parle-G Biscuits 800g", 4500, 1200, 100),
    ("Kurkure Masala Munch 90g", 2000, 1200, 120),
    ("Britannia Good Day 150g", 3500, 1200, 85),
    # Dairy
    ("Amul Butter 500g", 25000, 0, 30),
    ("Mother Dairy Curd 400g", 4200, 0, 45),
    ("Amul Gold Milk 500ml", 3200, 0, 60),
    # Household
    ("Vim Dishwash Bar 250g", 3500, 1800, 80),
    ("Harpic Power Plus 1L", 18900, 1800, 25),
    ("Ariel Detergent Powder 1kg", 25900, 1800, 40),
    ("Good Knight Refill", 8900, 1800, 50),
    ("Scotch-Brite Scrub Pad", 3900, 1800, 70),
]

assert len(PRODUCTS) == 24, "Seed list must have exactly 24 products"


def seed(dsn: str) -> None:
    """Insert products and initialise stock_balance rows."""
    with psycopg.connect(dsn, autocommit=False) as conn:
        with conn.cursor() as cur:
            for idx, (name, price_paise, tax_bp, opening_stock) in enumerate(PRODUCTS):
                sku = f"SKU{idx + 1:03d}"
                barcode = make_ean13(idx)

                cur.execute(
                    """
                    INSERT INTO products (sku, name, price_paise, tax_bp, barcode, opening_stock)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    ON CONFLICT (sku) DO UPDATE SET
                        name          = EXCLUDED.name,
                        price_paise   = EXCLUDED.price_paise,
                        tax_bp        = EXCLUDED.tax_bp,
                        barcode       = EXCLUDED.barcode,
                        opening_stock = EXCLUDED.opening_stock
                    """,
                    (sku, name, price_paise, tax_bp, barcode, opening_stock),
                )

                # Initialise or reset stock_balance
                cur.execute(
                    """
                    INSERT INTO stock_balance (sku, qty)
                    VALUES (%s, %s)
                    ON CONFLICT (sku) DO UPDATE SET qty = EXCLUDED.qty
                    """,
                    (sku, opening_stock),
                )

        conn.commit()
    print(f"Seeded {len(PRODUCTS)} products.")


if __name__ == "__main__":
    dsn = os.environ.get(
        "DATABASE_URL",
        "postgresql://till0:till0_secret@localhost:5433/till0",
    )
    seed(dsn)
