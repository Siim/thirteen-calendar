/**
 * Event details, the editor, the 13-month date field, the repeat and alert
 * pickers, the span and delete questions, and undo (docs/EVENTS.md §2.10 to
 * §2.14; web task B5). Re-exported from `@thirteen/ui`.
 */

export { type AlertOption, alertOptions, alertText, alertValue, sameAlarm } from './alerts.ts';
export { type Choice, ChoiceDialog, type ChoiceDialogProps } from './ChoiceDialog.tsx';
export {
  EDITOR_YEAR_RANGE,
  FULL_YEAR_RANGE,
  type YearRange,
  type YearStep,
  dateButtonLabel,
  dateButtonText,
  gregorianCaption,
  inYearRange,
  intercalaryName,
  isLeapOnly,
  monthCells,
  parseTypedDate,
  pickerCellLabel,
  pickerKeyMove,
  slotLabel,
  slotShortText,
  stepToYear,
  thirteenCaption,
  yearValueText,
} from './dateField.ts';
export {
  type EditorField,
  type FieldIssue,
  MAX_REPEAT_COUNT,
  type SeriesContext,
  type SpanChoice,
  type SpanQuestion,
  deleteQuestion,
  draftIssues,
  duplicateDraft,
  exceptionsRemovedNotice,
  fieldIssue,
  isDirty,
  laterDeletedNotice,
  normalizeUrl,
  pickerEnd,
  saveSpanQuestion,
  seriesContext,
  trimAlarms,
  visibleIssues,
  zoneCity,
} from './editorModel.ts';
export {
  type EventDetailsActions,
  EventDetails,
  type EventDetailsProps,
  detailsOffers,
  mapsUrl,
  readOnlyReasonText,
} from './EventDetails.tsx';
export { type AlertSupport, type EditorRequest, type EditorResult, EventEditor, type EventEditorProps } from './EventEditor.tsx';
export {
  type CustomFrequency,
  type CustomRepeat,
  type OnThe,
  type OnTheKind,
  type RepeatRow,
  customExpressible,
  customFrom,
  customRRule,
  customRecurrence,
  isRepeatEditable,
  repeatDescription,
  repeatRows,
  selectedRepeatRow,
  withRepeatEnd,
} from './repeat.ts';
export { CustomRepeatForm, RepeatPanel, RepeatPicker, type RepeatPickerProps } from './RepeatPicker.tsx';
export { DATE_PICKER_TAB_KEY, DatePickerPanel, ThirteenDateField, type ThirteenDateFieldProps } from './ThirteenDateField.tsx';
export {
  EventUndo,
  type EventUndoOptions,
  type HoldOptions,
  UNDO_LIMIT,
  type UndoChangeKind,
  type WriteOptions,
  causeReason,
  commitCauseOf,
  commitFailedText,
  failedCommitText,
} from '../undo.ts';
export { EventUndoProvider, type EventUndoProviderProps, useEventUndo } from '../EventUndoProvider.tsx';
