/**
 * The classification lines a document prints for a unit.
 *
 * A quotation, a booking and a payment plan all answer the same buyer question — which
 * property is this, and what is it — and none of them should have to carry the whole
 * inventory payload to say so. This resolves the stored keys against the tenant's own
 * vocabulary the same way the inventory route does, so a unit sitting on a renamed or
 * retired option still prints the word this workspace uses rather than a raw key.
 *
 * It is read-only and lives outside the routes so bookings and payments can import it
 * without reaching into each other's handlers. It never throws for a missing unit: a
 * booking whose unit row has gone must still print its own document, with a dash where
 * the property details would be.
 */

import { get } from "./db.ts"

import type { UnitRow } from "./routes/project-inventory.ts"

import {
  describeOption,
  findOption,
  readCategoryMaps,
} from "./routes/inventory-options.ts"

import {
  PROPERTY_TYPE_FOR_UNIT_TYPE,
  isUnitFacing,
  saleModeAllowsInstallments,
  unitDetailFieldsFor,
  unitDetailSummary,
  type UnitFacts,
} from "../shared/inventory-categories.ts"

import { isUnitType } from "../shared/inventory.ts"

export type { UnitFacts }

/** The unit's printable classification, or null when the unit no longer exists. */

export function readUnitFacts(
  tenantId: string,

  projectId: string,

  unitId: string,
): UnitFacts | null {
  const row = get<UnitRow>(
    `SELECT * FROM inventory_units
      WHERE tenant_id = ? AND project_id = ? AND id = ?`,

    tenantId,

    projectId,

    unitId,
  )

  if (!row) return null

  return unitFacts(tenantId, row)
}

/** The same facts from a row already in hand, so a caller never re-reads the unit. */

export function unitFacts(tenantId: string, row: UnitRow): UnitFacts {
  const categories = readCategoryMaps(tenantId)

  const propertyType = findOption(
    categories,
    "property_type",
    row.property_type,
  )

  // A unit classified only by the coarse family still prints a type: the mapping is the

  // same one the migration backfilled, so the document and the filter chips agree.

  const propertyTypeLabel =
    describeOption("property_type", row.property_type, categories) ??
    describeOption(
      "property_type",

      PROPERTY_TYPE_FOR_UNIT_TYPE[
        isUnitType(row.unit_type) ? row.unit_type : "plot"
      ],

      categories,
    )

  const sizeUnit = findOption(categories, "size_unit", row.size_unit)

  const visible = unitDetailFieldsFor(
    row.usage_category ?? "",

    propertyType?.isLand ?? false,

    false,
  )

  return {
    unitCode: row.unit_code,

    propertyType: propertyTypeLabel,

    subtype: describeOption(
      "property_subtype",
      row.property_subtype,
      categories,
    ),

    usage: describeOption("usage_category", row.usage_category, categories),

    furnishing: describeOption("furnishing", row.furnishing, categories),

    saleMode: describeOption("sale_mode", row.sale_mode, categories),

    allowsInstallments: saleModeAllowsInstallments(row.sale_mode ?? ""),

    possession: describeOption(
      "possession_status",

      row.possession,

      categories,
    ),

    ownership: describeOption("ownership_type", row.ownership, categories),

    sizeDisplay: sizeDisplay(row, sizeUnit?.valueNum ?? 1, categories),

    detailSummary: unitDetailSummary(
      {
        bedrooms: row.bedrooms,

        bathrooms: row.bathrooms,

        lounges: row.lounges,

        parking: row.parking,

        facing: isUnitFacing(row.facing)
          ? row.facing.charAt(0).toUpperCase() + row.facing.slice(1)
          : null,

        floorNumber: row.floor_number,
      },

      visible,
    ),

    address: row.address,

    areaCity: row.area_city,
  }
}

/**
 * The size in the unit it was sold in.
 *
 * `size_value` is what the seller typed and `size_unit` what they typed it in, so those
 * two print first. A unit recorded before either column existed still has a square-foot
 * figure, which is real data and prints as itself; only when even that is zero is there
 * nothing to say, and the caller shows a dash.
 */

function sizeDisplay(
  row: UnitRow,

  factor: number,

  categories: ReturnType<typeof readCategoryMaps>,
): string | null {
  const sizeUnitLabel = describeOption("size_unit", row.size_unit, categories)

  const sizeValue =
    row.size_value ??
    (row.size_sqft > 0
      ? Math.round((row.size_sqft / factor) * 100) / 100
      : null)

  if (sizeValue !== null && sizeUnitLabel !== null) {
    return `${Math.round(sizeValue * 100) / 100} ${sizeUnitLabel}`
  }

  if (row.size_sqft > 0) return `${row.size_sqft} sq ft`

  return null
}
