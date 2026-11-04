/**
 * The property-category block of the unit form, split into its four grouped sections.
 *
 * Migration 0054 made "what kind of thing is this" nine dropdown lists the workspace
 * owns, so the form cannot be a fixed grid of inputs any more: a shop has no bedrooms
 * and a plot has no floor number. The server already answers which fields a
 * classification makes relevant (`category.visibleFields`), and this module answers the
 * same question for a type the user has just picked but not yet saved, using the one
 * shared function both sides call — so the two answers cannot disagree.
 *
 * Three decisions worth stating:
 *
 *  * Every control is a string until submit. A half-typed `4.` in a numeric field is a
 *    person mid-keystroke, not an invalid value, and clearing a number by select-all and
 *    typing would otherwise be impossible.
 *
 *  * The size is typed in the workspace's own unit. `4.5 Marla` is what a dealer says on
 *    the phone; the square feet every other screen reads are derived from the tenant's
 *    conversion factor and shown beside the field, never asked for.
 *
 *  * Choosing a property type re-derives the coarse family, the usage category and the
 *    variant list. A unit typed as a Flat that still claims four bedrooms is the kind of
 *    contradiction a printed quotation would embarrass someone with.
 */

import { Plus, Star, X } from "lucide-react"

import { Button } from "@/components/ui/button"

import { Input } from "@/components/ui/input"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { Textarea } from "@/components/ui/textarea"

import { Field, FieldGrid } from "@/components/field"

import { readFileAsDataUrl } from "@/features/documents/document-utils"

import {
  optionsOf,
  subtypeOptionsFor,
  type InventoryOptionView,
  type InventoryOptionsResponse,
} from "@/lib/inventory-categories-api"

import type { InventoryOptionKind } from "@shared/inventory-categories"

import type {
  UnitCategoryView,
  UnitClassificationInput,
  UnitMediaInput,
} from "@/lib/project-inventory-api"

import {
  AMENITY_KEYS_PER_UNIT_MAX,
  UNIT_ADDRESS_MAX,
  UNIT_AGE_MAX,
  UNIT_AREA_MAX,
  UNIT_COORDINATE_DECIMALS,
  UNIT_DESCRIPTION_MAX,
  UNIT_FACING_LABELS,
  UNIT_FACINGS,
  UNIT_MEDIA_HREF_MAX,
  UNIT_MEDIA_KIND_LABELS,
  UNIT_MEDIA_KINDS,
  UNIT_MEDIA_LABEL_MAX,
  UNIT_NOTES_MAX,
  UNIT_PHOTOS_MAX,
  UNIT_ROOM_COUNT_MAX,
  UNIT_SIZE_VALUE_MAX,
  UNIT_SIZE_VALUE_MIN,
  UNIT_VIEW_MAX,
  roundSizeValue,
  sizeToSquareFeet,
  squareFeetToSize,
  unitDetailFieldsFor,
  type UnitDetailFieldSet,
  type UnitMediaKind,
} from "@shared/inventory-categories"

/** One media row being edited. `rowId` exists only to keep React's keys stable. */

export interface MediaDraft {
  rowId: string

  kind: UnitMediaKind

  href: string

  label: string

  isMain: boolean
}

/** Every classification control, held as typed text. */

export interface UnitClassificationDraft {
  propertyType: string

  subtype: string

  usageCategory: string

  furnishing: string

  saleMode: string

  possession: string

  ownership: string

  ownershipNotes: string

  sizeValue: string

  sizeUnit: string

  bedrooms: string

  bathrooms: string

  kitchens: string

  lounges: string

  floorsCount: string

  floorNumber: string

  parking: string

  facing: string

  view: string

  ageYears: string

  address: string

  areaCity: string

  latitude: string

  longitude: string

  description: string

  amenities: string[]

  media: MediaDraft[]
}

/**
 * A blank classification.
 *
 * `size_unit` defaults to square feet because that is the one conversion every
 * workspace agrees on, and it is the server's own fallback for a row that never
 * named one.
 */

export const EMPTY_CLASSIFICATION: UnitClassificationDraft = {
  propertyType: "",

  subtype: "",

  usageCategory: "",

  furnishing: "",

  saleMode: "",

  possession: "",

  ownership: "",

  ownershipNotes: "",

  sizeValue: "",

  sizeUnit: "square_feet",

  bedrooms: "",

  bathrooms: "",

  kitchens: "",

  lounges: "",

  floorsCount: "",

  floorNumber: "",

  parking: "",

  facing: "",

  view: "",

  ageYears: "",

  address: "",

  areaCity: "",

  latitude: "",

  longitude: "",

  description: "",

  amenities: [],

  media: [],
}

let mediaRowCounter = 0

/** A row id that is never sent anywhere. */

function nextMediaId(): string {
  mediaRowCounter += 1

  return `media-${mediaRowCounter}`
}

function text(value: string | number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value)
}

/**
 * A stored unit's category block, as form state.
 *
 * Read from the resolved labels' keys rather than the labels: a unit sitting on a
 * renamed option has to come back into the editor holding the key it actually stores,
 * or saving the form would silently move it to whatever row spells the old word.
 */

export function classificationFromCategory(
  category: UnitCategoryView,
): UnitClassificationDraft {
  return {
    ...EMPTY_CLASSIFICATION,

    propertyType: category.propertyTypeKey ?? "",

    subtype: category.subtypeKey ?? "",

    usageCategory: category.usageKey ?? "",

    furnishing: category.furnishingKey ?? "",

    saleMode: category.saleModeKey ?? "",

    possession: category.possessionKey ?? "",

    ownership: category.ownershipKey ?? "",

    ownershipNotes: category.ownershipNotes ?? "",

    sizeValue: text(category.sizeValue),

    sizeUnit: category.sizeUnitKey ?? "square_feet",

    bedrooms: text(category.bedrooms),

    bathrooms: text(category.bathrooms),

    kitchens: text(category.kitchens),

    lounges: text(category.lounges),

    floorsCount: text(category.floorsCount),

    floorNumber: text(category.floorNumber),

    parking: text(category.parking),

    facing: category.facing ?? "",

    view: category.view ?? "",

    ageYears: text(category.ageYears),

    address: category.address ?? "",

    areaCity: category.areaCity ?? "",

    latitude: text(category.latitude),

    longitude: text(category.longitude),

    description: category.description ?? "",

    amenities: [...category.amenityKeys],

    media: category.media.map((item) => ({
      rowId: nextMediaId(),

      kind: item.kind,

      href: item.href,

      label: item.label ?? "",

      isMain: item.isMain,
    })),
  }
}

/**
 * Every detail field switched on.
 *
 * The fallback for a form whose vocabulary has not arrived yet, chosen so a slow
 * request shows every control rather than hiding rooms nobody recorded: an empty field
 * that is visible is a missing value, and an absent field is a claim the unit has no
 * bedrooms. Once the lists land this is replaced by the server's own answer.
 */

export const FULL_DETAIL_FIELDS: UnitDetailFieldSet = {
  bedrooms: true,

  bathrooms: true,

  kitchens: true,

  lounges: true,

  floorsCount: true,

  floorNumber: true,

  parking: true,

  facing: true,

  view: true,

  ageYears: true,

  subtype: true,

  amenities: true,
}

/** Blank unless the cell holds a finite number. Cleared fields go back as null. */

function numberOrNull(value: string): number | null {
  const trimmed = value.trim()

  if (trimmed === "") return null

  const parsed = Number(trimmed)

  return Number.isFinite(parsed) ? parsed : null
}

function blankToNull(value: string): string | null {
  const trimmed = value.trim()

  return trimmed === "" ? null : trimmed
}

/**
 * The write payload for the whole classification block.
 *
 * Every field is present, including the empty ones as `null`. A PATCH that omits a
 * field leaves the stored value alone, so an editor that sent only what it rendered
 * would be unable to clear a size unit or drop an amenity — and the fields a
 * re-typed property type has just hidden are exactly the ones that must be nulled out,
 * or a Flat keeps a Villa's four bedrooms.
 */

export function classificationInput(
  draft: UnitClassificationDraft,
): UnitClassificationInput {
  return {
    propertyType: blankToNull(draft.propertyType),

    subtype: blankToNull(draft.subtype),

    usageCategory: blankToNull(draft.usageCategory),

    furnishing: blankToNull(draft.furnishing),

    saleMode: blankToNull(draft.saleMode),

    possession: blankToNull(draft.possession),

    ownership: blankToNull(draft.ownership),

    ownershipNotes: blankToNull(draft.ownershipNotes),

    sizeValue: numberOrNull(draft.sizeValue),

    sizeUnit: blankToNull(draft.sizeUnit),

    bedrooms: numberOrNull(draft.bedrooms),

    bathrooms: numberOrNull(draft.bathrooms),

    kitchens: numberOrNull(draft.kitchens),

    lounges: numberOrNull(draft.lounges),

    floorsCount: numberOrNull(draft.floorsCount),

    floorNumber: numberOrNull(draft.floorNumber),

    parking: numberOrNull(draft.parking),

    facing: blankToNull(draft.facing),

    view: blankToNull(draft.view),

    ageYears: numberOrNull(draft.ageYears),

    address: blankToNull(draft.address),

    areaCity: blankToNull(draft.areaCity),

    latitude: numberOrNull(draft.latitude),

    longitude: numberOrNull(draft.longitude),

    description: blankToNull(draft.description),

    amenities: draft.amenities,

    media: mediaInput(draft.media),
  }
}

/** Media rows, dropped if blank and main-picked if the user chose more than one. */

export function mediaInput(rows: readonly MediaDraft[]): UnitMediaInput[] {
  const kept = rows.filter((row) => row.href.trim() !== "")

  const mainIndex = kept.findIndex((row) => row.isMain)

  return kept.map((row, index) => ({
    kind: row.kind,

    href: row.href.trim(),

    label: blankToNull(row.label),

    // At most one main photo. The first tick wins, which is what a person who

    // ticked two meant the first time they ticked one.

    isMain: mainIndex === -1 ? index === 0 : index === mainIndex,
  }))
}

/** The factor of one size unit, or 1 when the unit is unknown. */

export function sizeUnitFactor(
  vocabulary: InventoryOptionsResponse | null,

  sizeUnitKey: string,
): number {
  if (vocabulary === null) return 1

  const option = optionsOf(vocabulary, "size_unit").find(
    (entry) => entry.key === sizeUnitKey,
  )

  return option?.valueNum ?? 1
}

/**
 * The square feet a typed size means, or null when the size is not typed yet.
 *
 * Computed with the tenant's own conversion row, which is the only way the figure the
 * form previews and the figure the server stores can be relied on to match.
 */

export function draftSquareFeet(
  draft: UnitClassificationDraft,

  vocabulary: InventoryOptionsResponse | null,
): number | null {
  const value = numberOrNull(draft.sizeValue)

  if (value === null) return null

  return sizeToSquareFeet(value, sizeUnitFactor(vocabulary, draft.sizeUnit))
}

/**
 * Which detail fields this draft's classification makes relevant.
 *
 * The same shared function the server calls, fed from the property-type row the user
 * just picked — so the form hides bedrooms on a Shop before anything is saved.
 */

export function draftVisibleFields(
  draft: UnitClassificationDraft,

  vocabulary: InventoryOptionsResponse | null,

  fallback: UnitDetailFieldSet,
): UnitDetailFieldSet {
  if (vocabulary === null || draft.propertyType === "") return fallback

  const typeOption = optionsOf(vocabulary, "property_type").find(
    (option) => option.key === draft.propertyType,
  )

  if (typeOption === undefined) return fallback

  const usageKey =
    draft.usageCategory !== ""
      ? draft.usageCategory
      : (typeOption.usageKey ?? "residential")

  return unitDetailFieldsFor(
    usageKey,

    typeOption.isLand,

    subtypeOptionsFor(vocabulary, draft.propertyType).length > 0,
  )
}

/** The choices for one list, with the stored value kept selectable if it was retired. */

function choicesWithStored(
  vocabulary: InventoryOptionsResponse | null,

  kind: InventoryOptionKind,

  stored: string,

  parentKey: string | null = null,
): Array<{
  value: string

  label: string
}> {
  const live =
    kind === "property_subtype"
      ? subtypeOptionsFor(vocabulary, parentKey)
      : optionsOf(vocabulary, kind)

  const choices = live.map((option) => ({
    value: option.key,

    label: option.label,
  }))

  if (stored !== "" && !choices.some((choice) => choice.value === stored)) {
    // A retired option still has to be shown by its own word rather than its key, so a

    // unit sitting on a hidden option reads as "Corner Shop (no longer offered)".

    const retired =
      vocabulary === null
        ? undefined
        : (vocabulary.archived[kind] ?? []).find(
            (option) => option.key === stored,
          )

    choices.push({
      value: stored,

      label: retired?.label ?? `${stored} (no longer offered)`,
    })
  }

  return choices
}

interface SectionProps {
  draft: UnitClassificationDraft

  update: (patch: Partial<UnitClassificationDraft>) => void

  vocabulary: InventoryOptionsResponse | null

  errors: Record<string, string>
}

/**
 * Basic: what the unit is, how it is sold, and how big it is.
 *
 * Property type is the first control because it drives the rest: the variants, the
 * usage, the coarse family the rest of the product counts by, and which fields appear
 * below it.
 */

export function UnitBasicsFields({
  draft,

  update,

  vocabulary,

  errors,
}: SectionProps) {
  const subtypes = choicesWithStored(
    vocabulary,

    "property_subtype",

    draft.subtype,

    draft.propertyType,
  )

  const factor = sizeUnitFactor(vocabulary, draft.sizeUnit)

  const sqft = draftSquareFeet(draft, vocabulary)

  function choosePropertyType(key: string) {
    const typeOption =
      vocabulary === null
        ? undefined
        : optionsOf(vocabulary, "property_type").find(
            (option) => option.key === key,
          )

    // Retyping the unit drops the variant that hung off the old type, and re-adopts the

    // usage the new type implies. Keeping a Corner Shop on a row that is now a Flat is a

    // contradiction the filter chips would then show side by side.

    update({
      propertyType: key,

      subtype: "",

      usageCategory: typeOption?.usageKey ?? draft.usageCategory,
    })
  }

  function chooseSizeUnit(key: string) {
    const nextFactor = sizeUnitFactor(vocabulary, key)

    const value = numberOrNull(draft.sizeValue)

    // Re-scale the typed number when there is one, so `9 Marla` switched to kanal still

    // means the same plot. Without a typed value there is nothing to convert.

    const converted =
      value === null || nextFactor <= 0 || factor <= 0
        ? value
        : squareFeetToSize(sizeToSquareFeet(value, factor) ?? 0, nextFactor)

    update({
      sizeUnit: key,

      sizeValue: converted === null ? draft.sizeValue : String(converted),
    })
  }

  return (
    <>
      <FieldGrid>
        <Field
          label="Property type"
          htmlFor="unit-property-type"
          required
          error={errors.propertyType}
          hint="Drives the variants, the fields below, and how this unit is counted."
        >
          <Select value={draft.propertyType} onValueChange={choosePropertyType}>
            <SelectTrigger id="unit-property-type" aria-label="Property type">
              <SelectValue placeholder="Choose a property type" />
            </SelectTrigger>

            <SelectContent>
              {choicesWithStored(
                vocabulary,

                "property_type",

                draft.propertyType,
              ).map((choice) => (
                <SelectItem key={choice.value} value={choice.value}>
                  {choice.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        {draft.propertyType !== "" && subtypes.length > 0 ? (
          <Field
            label="Sub-type"
            htmlFor="unit-subtype"
            error={errors.subtype}
            hint="Only the variants this property type offers."
          >
            <Select
              value={draft.subtype}
              onValueChange={(value) => update({ subtype: value })}
            >
              <SelectTrigger id="unit-subtype" aria-label="Sub-type">
                <SelectValue placeholder="No specific variant" />
              </SelectTrigger>

              <SelectContent>
                {subtypes.map((choice) => (
                  <SelectItem key={choice.value} value={choice.value}>
                    {choice.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        ) : null}
      </FieldGrid>

      <FieldGrid className="mt-3.5">
        <Field
          label="Usage category"
          htmlFor="unit-usage"
          error={errors.usageCategory}
          hint="Set from the property type; change it only for a mixed-use unit."
        >
          <Select
            value={draft.usageCategory}
            onValueChange={(value) => update({ usageCategory: value })}
          >
            <SelectTrigger id="unit-usage" aria-label="Usage category">
              <SelectValue placeholder="From the property type" />
            </SelectTrigger>

            <SelectContent>
              {choicesWithStored(
                vocabulary,

                "usage_category",

                draft.usageCategory,
              ).map((choice) => (
                <SelectItem key={choice.value} value={choice.value}>
                  {choice.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field
          label="Furnishing"
          htmlFor="unit-furnishing"
          error={errors.furnishing}
        >
          <Select
            value={draft.furnishing}
            onValueChange={(value) => update({ furnishing: value })}
          >
            <SelectTrigger id="unit-furnishing" aria-label="Furnishing">
              <SelectValue placeholder="Not recorded" />
            </SelectTrigger>

            <SelectContent>
              {choicesWithStored(
                vocabulary,

                "furnishing",

                draft.furnishing,
              ).map((choice) => (
                <SelectItem key={choice.value} value={choice.value}>
                  {choice.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </FieldGrid>

      <FieldGrid className="mt-3.5">
        <Field
          label="Sale / payment mode"
          htmlFor="unit-sale-mode"
          error={errors.saleMode}
          hint="Lump Sum units are booked without a payment plan."
        >
          <Select
            value={draft.saleMode}
            onValueChange={(value) => update({ saleMode: value })}
          >
            <SelectTrigger
              id="unit-sale-mode"
              aria-label="Sale or payment mode"
            >
              <SelectValue placeholder="Not recorded" />
            </SelectTrigger>

            <SelectContent>
              {choicesWithStored(
                vocabulary,

                "sale_mode",

                draft.saleMode,
              ).map((choice) => (
                <SelectItem key={choice.value} value={choice.value}>
                  {choice.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field
          label="Possession status"
          htmlFor="unit-possession"
          error={errors.possession}
        >
          <Select
            value={draft.possession}
            onValueChange={(value) => update({ possession: value })}
          >
            <SelectTrigger id="unit-possession" aria-label="Possession status">
              <SelectValue placeholder="Not recorded" />
            </SelectTrigger>

            <SelectContent>
              {choicesWithStored(
                vocabulary,

                "possession_status",

                draft.possession,
              ).map((choice) => (
                <SelectItem key={choice.value} value={choice.value}>
                  {choice.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </FieldGrid>

      <FieldGrid className="mt-3.5">
        <Field
          label="Ownership / legal"
          htmlFor="unit-ownership"
          error={errors.ownership}
        >
          <Select
            value={draft.ownership}
            onValueChange={(value) => update({ ownership: value })}
          >
            <SelectTrigger id="unit-ownership" aria-label="Ownership type">
              <SelectValue placeholder="Not recorded" />
            </SelectTrigger>

            <SelectContent>
              {choicesWithStored(
                vocabulary,

                "ownership_type",

                draft.ownership,
              ).map((choice) => (
                <SelectItem key={choice.value} value={choice.value}>
                  {choice.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field
          label="Legal notes"
          htmlFor="unit-ownership-notes"
          error={errors.ownershipNotes}
          hint="Anything a buyer must be told before signing."
        >
          <Input
            id="unit-ownership-notes"
            value={draft.ownershipNotes}
            maxLength={UNIT_NOTES_MAX}
            autoComplete="off"
            placeholder="Registry pending with the society"
            onChange={(event) => update({ ownershipNotes: event.target.value })}
          />
        </Field>
      </FieldGrid>

      <FieldGrid className="mt-3.5">
        <Field
          label="Size"
          htmlFor="unit-size-value"
          required
          error={errors.sizeValue ?? errors.sizeSqft}
          hint={
            sqft === null
              ? `Between ${UNIT_SIZE_VALUE_MIN} and ${UNIT_SIZE_VALUE_MAX}.`
              : `Equals ${sqft.toLocaleString("en-US")} sq ft, which is what every other screen reads.`
          }
        >
          <Input
            id="unit-size-value"
            type="number"
            inputMode="decimal"
            min={UNIT_SIZE_VALUE_MIN}
            max={UNIT_SIZE_VALUE_MAX}
            step="0.01"
            value={draft.sizeValue}
            placeholder="4.5"
            onChange={(event) =>
              update({
                sizeValue:
                  event.target.value === ""
                    ? ""
                    : String(roundSizeValue(Number(event.target.value) || 0)),
              })
            }
          />
        </Field>

        <Field
          label="Size unit"
          htmlFor="unit-size-unit"
          error={errors.sizeUnit}
          hint="Marla, kanal, sq ft — your workspace's own list and factors."
        >
          <Select value={draft.sizeUnit} onValueChange={chooseSizeUnit}>
            <SelectTrigger id="unit-size-unit" aria-label="Size unit">
              <SelectValue placeholder="Square feet" />
            </SelectTrigger>

            <SelectContent>
              {choicesWithStored(
                vocabulary,

                "size_unit",

                draft.sizeUnit,
              ).map((choice) => (
                <SelectItem key={choice.value} value={choice.value}>
                  {choice.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </FieldGrid>
    </>
  )
}

interface DetailProps
  extends SectionProps {

  /** Which of these fields the chosen classification makes relevant. */
  visible: UnitDetailFieldSet
}

/**
 * Details: the rooms and the amenities, shown only where they mean something.
 *
 * A Shop gets no bedrooms and no kitchen, and a Plot gets nothing from this section
 * except its frontage-style fields. Hiding them is not decoration: a blank bedroom
 * count on a warehouse reads as missing data, and a zero reads as a claim.
 */

export function UnitDetailFields({
  draft,

  update,

  vocabulary,

  errors,

  visible,
}: DetailProps) {
  const amenities = vocabulary === null ? [] : optionsOf(vocabulary, "amenity")

  const selected = draft.amenities

  const amenityLabel = new Map(
    [...amenities, ...(vocabulary?.archived.amenity ?? [])].map((option) => [
      option.key,

      option.label,
    ]),
  )

  function toggleAmenity(key: string) {
    update({
      amenities: selected.includes(key)
        ? selected.filter((entry) => entry !== key)
        : [...selected, key],
    })
  }

  const show = (field: keyof UnitDetailFieldSet) => visible[field]

  return (
    <>
      <FieldGrid>
        {show("bedrooms") ? (
          <CountField
            label="Bedrooms"
            htmlFor="unit-bedrooms"
            value={draft.bedrooms}
            error={errors.bedrooms}
            onChange={(value) => update({ bedrooms: value })}
          />
        ) : null}

        {show("bathrooms") ? (
          <CountField
            label="Bathrooms"
            htmlFor="unit-bathrooms"
            value={draft.bathrooms}
            error={errors.bathrooms}
            onChange={(value) => update({ bathrooms: value })}
          />
        ) : null}

        {show("kitchens") ? (
          <CountField
            label="Kitchens"
            htmlFor="unit-kitchens"
            value={draft.kitchens}
            error={errors.kitchens}
            onChange={(value) => update({ kitchens: value })}
          />
        ) : null}

        {show("lounges") ? (
          <CountField
            label="Drawing / lounge"
            htmlFor="unit-lounges"
            value={draft.lounges}
            error={errors.lounges}
            onChange={(value) => update({ lounges: value })}
          />
        ) : null}

        {show("floorsCount") ? (
          <CountField
            label="Floors in the unit"
            htmlFor="unit-floors-count"
            value={draft.floorsCount}
            error={errors.floorsCount}
            onChange={(value) => update({ floorsCount: value })}
          />
        ) : null}

        {show("floorNumber") ? (
          <CountField
            label="Floor number"
            htmlFor="unit-floor-number"
            value={draft.floorNumber}
            error={errors.floorNumber}
            onChange={(value) => update({ floorNumber: value })}
          />
        ) : null}

        {show("parking") ? (
          <CountField
            label="Parking"
            htmlFor="unit-parking"
            value={draft.parking}
            error={errors.parking}
            onChange={(value) => update({ parking: value })}
          />
        ) : null}

        {show("ageYears") ? (
          <CountField
            label="Age (years)"
            htmlFor="unit-age"
            value={draft.ageYears}
            error={errors.ageYears}
            max={UNIT_AGE_MAX}
            onChange={(value) => update({ ageYears: value })}
          />
        ) : null}
      </FieldGrid>

      <FieldGrid className="mt-3.5">
        <Field
          label="Facing"
          htmlFor="unit-facing"
          error={errors.facing}
          hint="Direction the main frontage looks. Feeds the facing premiums."
        >
          <Select
            value={draft.facing}
            onValueChange={(value) => update({ facing: value })}
          >
            <SelectTrigger id="unit-facing" aria-label="Facing">
              <SelectValue placeholder="Not recorded" />
            </SelectTrigger>

            <SelectContent>
              {UNIT_FACINGS.map((facing) => (
                <SelectItem key={facing} value={facing}>
                  {UNIT_FACING_LABELS[facing]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field
          label="View"
          htmlFor="unit-view"
          error={errors.view}
          hint="Park, pool, main boulevard."
        >
          <Input
            id="unit-view"
            value={draft.view}
            maxLength={UNIT_VIEW_MAX}
            autoComplete="off"
            placeholder="Park facing"
            onChange={(event) => update({ view: event.target.value })}
          />
        </Field>
      </FieldGrid>

      <div className="mt-4">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[13px] font-medium text-foreground">
            Amenities
          </span>

          <span className="text-[11.5px] text-muted-foreground">
            {selected.length}/{AMENITY_KEYS_PER_UNIT_MAX} selected
          </span>
        </div>

        <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
          Tap what this unit has. The list is yours to extend under Settings,
          Inventory Setup.
        </p>

        {errors.amenities && (
          <p className="mt-1 text-[11.5px] font-medium text-danger">
            {errors.amenities}
          </p>
        )}

        {amenities.length === 0 ? (
          <p className="mt-2 text-[12px] text-muted-foreground">
            No amenities are defined for this workspace yet.
          </p>
        ) : (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {amenities.map((option) => (
              <AmenityChip
                key={option.id}
                label={option.label}
                selected={selected.includes(option.key)}
                onToggle={() => toggleAmenity(option.key)}
              />
            ))}
          </div>
        )}

        {/* Selected entries that are no longer offered still have to be removable, or
            retiring an amenity would strand it on every unit that ever held it. */}
        {selected

          .filter((key) => !amenities.some((option) => option.key === key))

          .map((key) => (
            <div key={key} className="mt-2 flex flex-wrap gap-1.5">
              <AmenityChip
                label={amenityLabel.get(key) ?? `${key} (no longer offered)`}
                selected
                onToggle={() => toggleAmenity(key)}
              />
            </div>
          ))}
      </div>
    </>
  )
}

function AmenityChip({
  label,

  selected,

  onToggle,
}: {
  label: string

  selected: boolean

  onToggle: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onToggle}
      className={`rounded-full border px-2.5 py-1 text-[11.5px] transition-colors ${
        selected
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700"
          : "border-border bg-muted/20 text-muted-foreground hover:border-foreground/20"
      }`}
    >
      {label}
    </button>
  )
}

function CountField({
  label,

  htmlFor,

  value,

  error,

  onChange,

  max = UNIT_ROOM_COUNT_MAX,
}: {
  label: string

  htmlFor: string

  value: string

  error?: string

  onChange: (value: string) => void

  max?: number
}) {
  return (
    <Field label={label} htmlFor={htmlFor} error={error}>
      <Input
        id={htmlFor}
        type="number"
        inputMode="numeric"
        min={0}
        max={max}
        step={1}
        value={value}
        placeholder="0"
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  )
}

/** Location: the address, the area, an optional map pin, and the sales blurb. */

export function UnitLocationFields({
  draft,

  update,

  errors,
}: SectionProps) {
  return (
    <>
      <FieldGrid>
        <Field
          label="Address"
          htmlFor="unit-address"
          error={errors.address}
          hint="Street and building, as a buyer would write it."
        >
          <Input
            id="unit-address"
            value={draft.address}
            maxLength={UNIT_ADDRESS_MAX}
            autoComplete="off"
            placeholder="Plot 12, Block C, Ring Road"
            onChange={(event) => update({ address: event.target.value })}
          />
        </Field>

        <Field
          label="Area / city"
          htmlFor="unit-area-city"
          error={errors.areaCity}
        >
          <Input
            id="unit-area-city"
            value={draft.areaCity}
            maxLength={UNIT_AREA_MAX}
            autoComplete="off"
            placeholder="Bahria Town, Lahore"
            onChange={(event) => update({ areaCity: event.target.value })}
          />
        </Field>
      </FieldGrid>

      <FieldGrid className="mt-3.5">
        <Field
          label="Latitude"
          htmlFor="unit-latitude"
          error={errors.latitude}
          hint={`Optional. Up to ${UNIT_COORDINATE_DECIMALS} decimals.`}
        >
          <Input
            id="unit-latitude"
            value={draft.latitude}
            autoComplete="off"
            inputMode="decimal"
            placeholder="24.9123"
            onChange={(event) => update({ latitude: event.target.value })}
          />
        </Field>

        <Field
          label="Longitude"
          htmlFor="unit-longitude"
          error={errors.longitude}
          hint="Optional. With latitude, this places a pin."
        >
          <Input
            id="unit-longitude"
            value={draft.longitude}
            autoComplete="off"
            inputMode="decimal"
            placeholder="67.0412"
            onChange={(event) => update({ longitude: event.target.value })}
          />
        </Field>
      </FieldGrid>

      <div className="mt-3.5">
        <Field
          label="Short description"
          htmlFor="unit-description"
          error={errors.description}
          hint="Printed under the unit on a quotation. Leave blank rather than inventing one."
        >
          <Textarea
            id="unit-description"
            value={draft.description}
            maxLength={UNIT_DESCRIPTION_MAX}
            rows={3}
            placeholder="Corner shop on the main boulevard, glass frontage, ready to hand over."
            onChange={(event) => update({ description: event.target.value })}
          />
        </Field>
      </div>
    </>
  )
}

/**
 * Media: photos, a floor plan, an optional video link, and which photo is the main one.
 *
 * An href is either a link the buyer can click or a file the workspace attached, which
 * arrives as a data URL — the same way expense receipts and documents are stored, so no
 * upload endpoint has to be invented for a unit.
 */

export function UnitMediaFields({
  draft,

  update,

  vocabulary,

  errors,
}: SectionProps) {
  const rows = draft.media

  const photoCount = rows.filter((row) => row.kind === "photo").length

  function patch(rowId: string, next: Partial<MediaDraft>) {
    update({
      media: rows.map((row) =>
        row.rowId === rowId ? { ...row, ...next } : row,
      ),
    })
  }

  function add(kind: UnitMediaKind) {
    update({
      media: [
        ...rows,

        {
          rowId: nextMediaId(),
          kind,
          href: "",
          label: "",
          isMain: rows.length === 0,
        },
      ],
    })
  }

  function markMain(rowId: string) {
    update({
      media: rows.map((row) => ({ ...row, isMain: row.rowId === rowId })),
    })
  }

  async function attach(rowId: string, file: File | undefined) {
    if (file === undefined) return

    try {
      patch(rowId, { href: await readFileAsDataUrl(file) })
    } catch {
      patch(rowId, { href: "" })
    }
  }

  return (
    <>
      {errors.media && (
        <p className="mb-2 text-[11.5px] font-medium text-danger">
          {errors.media}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">
          No photo, floor plan or video link recorded yet.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((row, index) => (
            <div
              key={row.rowId}
              className="flex items-start gap-2 rounded-md border border-border bg-muted/20 p-2"
            >
              <Select
                value={row.kind}
                onValueChange={(value) =>
                  patch(row.rowId, { kind: value as UnitMediaKind })
                }
              >
                <SelectTrigger
                  size="sm"
                  className="w-32 shrink-0"
                  aria-label={`Media ${index + 1} kind`}
                >
                  <SelectValue />
                </SelectTrigger>

                <SelectContent>
                  {UNIT_MEDIA_KINDS.map((kind) => (
                    <SelectItem key={kind} value={kind}>
                      {UNIT_MEDIA_KIND_LABELS[kind]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Input
                  value={row.href}
                  maxLength={UNIT_MEDIA_HREF_MAX}
                  autoComplete="off"
                  aria-label={`Media ${index + 1} link`}
                  placeholder="https://… or attach a file"
                  onChange={(event) =>
                    patch(row.rowId, { href: event.target.value })
                  }
                />

                <Input
                  value={row.label}
                  maxLength={UNIT_MEDIA_LABEL_MAX}
                  autoComplete="off"
                  aria-label={`Media ${index + 1} caption`}
                  placeholder="Caption — storefront, evening"
                  className="text-[12px]"
                  onChange={(event) =>
                    patch(row.rowId, { label: event.target.value })
                  }
                />
              </div>

              <label className="flex h-8 shrink-0 cursor-pointer items-center gap-1.5 px-1 text-[11.5px] text-muted-foreground">
                <input
                  type="file"
                  accept="image/*,application/pdf,video/*"
                  className="sr-only"
                  onChange={(event) =>
                    void attach(row.rowId, event.target.files?.[0])
                  }
                />
                <span className="rounded-md border border-border px-2 py-1">
                  Attach
                </span>
              </label>

              {row.kind === "photo" ? (
                <Button
                  type="button"
                  variant={row.isMain ? "outline" : "ghost"}
                  size="icon-sm"
                  aria-label={`Make media ${index + 1} the main photo`}
                  title={row.isMain ? "Main photo" : "Set as main photo"}
                  className={`size-8 shrink-0 ${
                    row.isMain ? "text-emerald-700" : "text-muted-foreground"
                  }`}
                  onClick={() => markMain(row.rowId)}
                >
                  <Star
                    size={14}
                    className={row.isMain ? "fill-current" : ""}
                  />
                </Button>
              ) : null}

              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-8 shrink-0 text-muted-foreground"
                aria-label={`Remove media ${index + 1}`}
                onClick={() =>
                  update({
                    media: rows.filter((entry) => entry.rowId !== row.rowId),
                  })
                }
              >
                <X size={14} />
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={photoCount >= UNIT_PHOTOS_MAX}
          onClick={() => add("photo")}
        >
          <Plus size={13} />
          Add photo
        </Button>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => add("floor_plan")}
        >
          <Plus size={13} />
          Add floor plan
        </Button>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => add("video")}
        >
          <Plus size={13} />
          Add video link
        </Button>
      </div>

      {photoCount >= UNIT_PHOTOS_MAX ? (
        <p className="mt-1.5 text-[11.5px] text-warning">
          {UNIT_PHOTOS_MAX} photos is the limit for one unit.
        </p>
      ) : null}

      {vocabulary === null ? null : (
        <p className="mt-2 text-[11.5px] text-muted-foreground">
          The main photo is the one a quotation and the grid card show first.
        </p>
      )}
    </>
  )
}

/** A section heading with the one-line explanation the design asks for. */

export function FormSectionHeading({
  title,

  note,
}: {
  title: string

  note: string
}) {
  return (
    <div className="mb-2.5 border-b border-border pb-1.5">
      <h3 className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
        {title}
      </h3>

      <p className="mt-0.5 text-[11.5px] leading-4 text-muted-foreground">
        {note}
      </p>
    </div>
  )
}

/** One option, named for a message that has to work without the vocabulary loaded. */

export function optionLabel(
  options: readonly InventoryOptionView[],

  key: string | null,
): string | null {
  if (key === null || key === "") return null

  return options.find((option) => option.key === key)?.label ?? key
}
