// The fixed English sentences the setup reader (packages/inference/src/
// setup-reader.ts) and app_private.setup_read write as the reason a price
// row or fact is flagged. They live here, free of server code, so the setup
// screens can show them in Bahasa Melayu; the reader imports them from here
// and tests/domain/setup-reasons.test.ts keeps the SQL's copies equal.

// The comparison of two reads of a photo or PDF. The two price and unit
// sentences are written as `${prefix} (<a> and <b>). Please check.`; the
// fact one as `${prefix}: "<a>" and "<b>". Please check.`.
export const READER_DISAGREE_PREFIX =
  "Two readings of this document gave different prices";
export const READER_UNIT_DISAGREE_PREFIX =
  "Two readings of this document gave different units for this price";
export const READER_ONE_READ_ROW =
  "Only one of two readings found this row. Please check.";
export const READER_RENAMED_ROW =
  "The two readings named this row differently. Please check the name.";
export const READER_FACT_DISAGREE_PREFIX = "Two readings gave different answers";
export const READER_ONE_READ_FACT =
  "Only one of two readings found this answer. Please check.";
export const READER_READ_ONCE =
  "This document could only be read once. Please check every price.";
// ringgit(null) in the price sentence.
export const READER_NO_PRICE_AMOUNT = "no price";

// The reader's own checks of one row or fact.
export const READER_NO_PRICE = "No price was found for this item.";
export const READER_BAD_FIELD = "Part of this row could not be read.";
export const READER_PRICE_UNREAD = "The price could not be read.";
export const READER_PRICE_NOT_WHOLE = "The price was not a whole number of sen.";
export const READER_PRICE_RANGE = "The price is outside the allowed range.";
export const READER_ROW_UNSURE = "JomCall was not sure about this row.";
export const READER_FACT_BAD_FIELD = "Part of this value could not be read.";
export const READER_FACT_CUT = "The value was too long and was cut short.";
export const READER_FACT_UNSURE = "JomCall was not sure about this value.";

// setup_read: the same item and variant twice. Either the whole reason, or
// "; listed twice" after another one.
export const READER_LISTED_TWICE = "listed twice";
