import { ORDER_STATUS } from '../lib/format';
import { cx } from './ui';

export function StatusBadge({ status }) {
  const s = ORDER_STATUS[status] || {};
  return <span className={cx('chip whitespace-nowrap', s.cls)}><span className={cx('h-1.5 w-1.5 rounded-full', s.dot)} />{s.label || status}</span>;
}
