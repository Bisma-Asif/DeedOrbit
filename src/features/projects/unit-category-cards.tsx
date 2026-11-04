/**
 * Category-wise summary cards and the removable filter chips beside them.
 *
 * Both halves read the same thing — the counts the server computed over the units this
 * table is already showing — so a card can never disagree with the rows under it. That
 * is also why the numbers come from the list response rather than a second request: a
 * workspace-wide total sitting above a project's table would be a different answer to
 * the same question.
 *
 * A card is also a chip. Clicking "Shop" filters the table to shops, and clicking it
 * again clears it, because the first thing a reader asks of a count is "show me those".
 */

import { Badge } from "@/components/ui/badge"

import { Button } from "@/components/ui/button"

import { formatCurrencyCompact, formatNumber } from "@/lib/format"

import type { InventoryCategoryGroup } from "@/lib/inventory-categories-api"

interface UnitCategoryCardsProps {
  /** Per property type, over the units currently listed. Largest first. */

  groups: readonly InventoryCategoryGroup[]

  total: number

  currency: string

  /** The property type key the table is filtered to, or "" for all of them. */

  selectedKey: string

  onSelect: (key: string) => void
}

/**
 * The stock of a project, grouped by what kind of thing it is.
 *
 * "Available" is an open status rather than the one called Available, which is the same
 * reading the tiles above use: what a desk can sell today, not what a label says.
 */

export function UnitCategoryCards({
  groups,

  total,

  currency,

  selectedKey,

  onSelect,
}: UnitCategoryCardsProps) {
  if (groups.length === 0) return null

  const unclassified =
    total - groups.reduce((sum, group) => sum + group.total, 0)

  return (
    <div className="border-b border-border px-4 py-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          By property type
        </span>

        <span className="text-[11.5px] text-muted-foreground">
          {formatNumber(total)} {total === 1 ? "unit" : "units"}
        </span>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {groups.map((group) => {
          const selected = selectedKey === group.key

          return (
            <button
              key={group.key ?? "unclassified"}
              type="button"
              aria-pressed={selected}
              onClick={() => onSelect(selected ? "" : (group.key ?? ""))}
              className={`w-40 shrink-0 rounded-md border px-2.5 py-2 text-left transition-colors ${
                selected
                  ? "border-emerald-500/50 bg-emerald-500/8"
                  : "border-border bg-muted/20 hover:border-foreground/20 hover:bg-muted/30"
              }`}
            >
              <p className="truncate text-[12.5px] font-medium text-foreground">
                {group.label}
              </p>

              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {formatNumber(group.total)}{" "}
                {group.total === 1 ? "unit" : "units"} ·{" "}
                <span className="text-emerald-700">
                  {formatNumber(group.available)} open
                </span>
              </p>

              <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                {group.value > 0
                  ? formatCurrencyCompact(group.value, currency)
                  : "—"}
              </p>

              {group.subtypes.length > 0 ? (
                <p
                  className="mt-1 truncate text-[10.5px] text-muted-foreground"
                  title={group.subtypes

                    .slice(0, 4)

                    .map((subtype) => `${subtype.label} ${subtype.count}`)

                    .join(", ")}
                >
                  {group.subtypes

                    .slice(0, 3)

                    .map((subtype) => `${subtype.label} ${subtype.count}`)

                    .join(" · ")}
                </p>
              ) : null}
            </button>
          )
        })}

        {/* A project can hold units whose type row was deleted with them still on it —
            the count says how many rather than leaving the cards to add up to less. */}
        {unclassified > 0 ? (
          <div className="w-40 shrink-0 rounded-md border border-dashed border-border px-2.5 py-2">
            <p className="truncate text-[12.5px] font-medium text-foreground">
              No type recorded
            </p>

            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {formatNumber(unclassified)}{" "}
              {unclassified === 1 ? "unit" : "units"}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** One filter that is doing something, named the way the control named it. */

export interface ActiveFilterChip {
  key: string

  label: string

  value: string
}

interface ActiveFilterChipsProps {
  chips: readonly ActiveFilterChip[]

  onRemove: (key: string) => void

  onClearAll: () => void
}

/**
 * The filters the table is under, as removable chips.
 *
 * Dropdowns are efficient to set and impossible to read at a glance — six of them
 * looking identical is how a filtered table gets mistaken for the whole stock. The
 * chips say which of them are actually doing something, in the words that were chosen,
 * and each one clears itself.
 */

export function ActiveFilterChips({
  chips,

  onRemove,

  onClearAll,
}: ActiveFilterChipsProps) {
  if (chips.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-2">
      <span className="text-[11px] font-medium text-muted-foreground">
        Filtering by
      </span>

      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={() => onRemove(chip.key)}
          aria-label={`Remove the ${chip.label} filter`}
          className="group"
        >
          <Badge variant="outline" className="gap-1 pr-1">
            <span className="text-muted-foreground">{chip.label}:</span>

            <span className="text-foreground">{chip.value}</span>
          </Badge>
        </button>
      ))}

      <Button
        variant="ghost"
        size="sm"
        className="ml-auto h-7 text-[11.5px] text-muted-foreground"
        onClick={onClearAll}
      >
        Clear all ({chips.length})
      </Button>
    </div>
  )
}
