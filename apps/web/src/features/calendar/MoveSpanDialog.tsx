import { Button, Dialog, copy } from '@thirteen/ui';
import type { MoveChoice, MovePlan } from './moves.ts';
import styles from './TimelineMode.module.css';

export interface MoveSpanDialogProps {
  /** The question to ask; `null` keeps it closed. */
  readonly plan: Extract<MovePlan, { kind: 'ask' }> | null;
  readonly onChoose: (choice: MoveChoice) => void;
  readonly onCancel: () => void;
}

/**
 * The span question of a dragged repeating occurrence (docs/EVENTS.md §2.11,
 * board G4): "This is a repeating event." with what moving future events
 * does to the repeat and what it removes, said before the choice, then "Move
 * this event only", the future choice ("Move future events", "Move future
 * events and change repeat", or the destructive "Move and delete later
 * events") and "Cancel". Nothing moves until a choice is made.
 */
export function MoveSpanDialog({ plan, onChoose, onCancel }: MoveSpanDialogProps) {
  return (
    <Dialog
      open={plan !== null}
      onRequestClose={onCancel}
      title={plan?.title ?? copy('span.title')}
      role="alertdialog"
      size="sm"
      compact="center"
      description={plan?.message}
      footer={
        plan === null ? null : (
          <div className={styles.spanButtons}>
            {plan.choices.map((choice, index) => (
              <Button
                key={choice.id}
                variant={choice.destructive ? 'outline' : index === 0 ? 'solid' : 'outline'}
                className={choice.destructive ? styles.destructive : undefined}
                data-autofocus={index === 0 ? '' : undefined}
                onClick={() => onChoose(choice)}
              >
                {choice.label}
              </Button>
            ))}
            <Button variant="ghost" onClick={onCancel}>
              {copy('editor.cancel')}
            </Button>
          </div>
        )
      }
    >
      {plan !== null && plan.lines.length > 0 ? (
        <div className={styles.spanLines}>
          {plan.lines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      ) : null}
    </Dialog>
  );
}
