import { Kicker } from '@thirteen/ui';
import type { ReactNode } from 'react';
import styles from './PageHeader.module.css';

export interface PageHeaderProps {
  readonly mark: string;
  readonly kicker: ReactNode;
  readonly title: ReactNode;
  readonly lede?: ReactNode;
  /** Controls set to the right on wide screens. */
  readonly children?: ReactNode;
}

/** Page title block: section mark, display title, lede and controls. */
export function PageHeader({ mark, kicker, title, lede, children }: PageHeaderProps) {
  return (
    <header className={styles.head} data-reveal="rise">
      <div className={styles.text}>
        <Kicker mark={mark}>{kicker}</Kicker>
        <h1 className={styles.title}>{title}</h1>
        {lede !== undefined ? <p className={styles.lede}>{lede}</p> : null}
      </div>
      {children !== undefined ? <div className={styles.controls}>{children}</div> : null}
    </header>
  );
}
