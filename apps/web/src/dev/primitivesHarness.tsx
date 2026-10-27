/**
 * Development harness for the primitives of @thirteen/ui (Dialog, Popover, Menu,
 * Toast), served at /dev/primitives.html by the Vite dev server only (the build
 * has index.html as its one input). The e2e suite drives it in real browsers,
 * where the top layer, `showModal()`, the Popover API and Escape behave as they
 * do for users, which jsdom cannot show.
 *
 * Query: `?palette=<theme id>&theme=light|dark` pins the colours.
 */
import '@thirteen/ui/styles.css';
import { Button, Dialog, type DialogCloseReason, Menu, Popover, ToastProvider, useToast } from '@thirteen/ui';
import { StrictMode, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

const params = new URLSearchParams(window.location.search);
document.documentElement.dataset.palette = params.get('palette') ?? 'almanac';
document.documentElement.dataset.theme = params.get('theme') === 'dark' ? 'dark' : 'light';

function Log({ lines }: { readonly lines: readonly string[] }) {
  return (
    <ol data-testid="log" style={{ fontFamily: 'var(--t-font-mono)', fontSize: 12 }}>
      {lines.map((line, index) => (
        <li key={index}>{line}</li>
      ))}
    </ol>
  );
}

function Harness() {
  const toast = useToast();
  const [log, setLog] = useState<string[]>([]);
  const note = (line: string) => setLog((lines) => [...lines, line]);
  const [editor, setEditor] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [asking, setAsking] = useState(false);
  const [picker, setPicker] = useState(false);
  const pickerAnchor = useRef<HTMLButtonElement>(null);
  const [details, setDetails] = useState(false);
  const chip = useRef<HTMLButtonElement>(null);

  const requestClose = (reason: DialogCloseReason) => {
    note(`editor close requested: ${reason}`);
    if (dirty) setAsking(true);
    else setEditor(false);
  };

  return (
    <main style={{ padding: 32, display: 'grid', gap: 16, justifyItems: 'start' }}>
      <h1 style={{ fontSize: 24 }}>Primitives</h1>
      <Button onClick={() => setEditor(true)}>New event</Button>
      <Button ref={chip} onClick={() => setDetails((open) => !open)}>
        Sprint planning
      </Button>
      <Menu
        label="More"
        items={[
          { id: 'duplicate', label: 'Duplicate', onSelect: () => note('menu: duplicate') },
          { id: 'alerts', label: 'Edit alerts', disabled: true, onSelect: () => note('menu: alerts') },
          { kind: 'separator', id: 'sep' },
          { id: 'delete', label: 'Delete', destructive: true, shortcut: 'Delete', onSelect: () => note('menu: delete') },
        ]}
      />
      <Button
        onClick={() =>
          toast.show({
            message: 'Event deleted.',
            announcement: 'Event deleted. Undo available: Control Z.',
            action: { label: 'Undo', onAction: () => note('toast: undo') },
            onClose: (reason) => note(`toast closed: ${reason}`),
          })
        }
      >
        Delete
      </Button>
      <Log lines={log} />

      <Popover
        open={details}
        anchor={chip}
        arrow
        placement="right-start"
        aria-label="Sprint planning"
        width={300}
        onClose={(reason) => {
          note(`details closed: ${reason}`);
          setDetails(false);
        }}
      >
        <div style={{ padding: 16, display: 'grid', gap: 8 }}>
          <strong>Sprint planning</strong>
          <span>Thursday, October 12, 2026, 09:30 to 10:30</span>
          <Button size="sm">Edit</Button>
        </div>
      </Popover>

      <Dialog
        open={editor}
        onRequestClose={requestClose}
        title="New event"
        size="lg"
        layout="bar"
        compact="sheet"
        closeButton
        footer={
          <>
            <Button onClick={() => requestClose('close-button')}>Cancel</Button>
            <Button variant="solid" onClick={() => setEditor(false)}>
              Add
            </Button>
          </>
        }
      >
        <div style={{ display: 'grid', gap: 12 }}>
          <label>
            Title <input data-autofocus="" onChange={() => setDirty(true)} />
          </label>
          <Button ref={pickerAnchor} onClick={() => setPicker(true)}>
            IFC Thu, Oct 12, 2026
          </Button>
          <Popover
            open={picker}
            anchor={pickerAnchor}
            aria-label="Choose a date"
            initialFocus="first"
            onClose={(reason) => {
              note(`picker closed: ${reason}`);
              setPicker(false);
            }}
          >
            <div style={{ padding: 12, display: 'grid', gap: 4 }}>
              <button type="button">Thursday, October 12, 2026</button>
              <button type="button">Friday, October 13, 2026</button>
            </div>
          </Popover>
        </div>
      </Dialog>

      <Dialog
        open={asking}
        role="alertdialog"
        size="sm"
        title="Discard this event?"
        onRequestClose={() => setAsking(false)}
        footer={
          <>
            <Button onClick={() => setAsking(false)}>Keep editing</Button>
            <Button
              variant="solid"
              onClick={() => {
                setAsking(false);
                setEditor(false);
                setDirty(false);
              }}
            >
              Discard
            </Button>
          </>
        }
      />
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <Harness />
    </ToastProvider>
  </StrictMode>,
);
