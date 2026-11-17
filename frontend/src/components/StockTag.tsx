import { Link } from 'react-router-dom';
import { cn } from '../utils/format';

/**
 * The windshield stock sticker. LotFlow's signature mark: wherever a vehicle is
 * referenced, its stock number appears as the yellow tag the lot team actually reads.
 */
export function StockTag({ id, size = 'md', link = false, className }: { id: string; size?: 'sm' | 'md' | 'lg' | 'xl'; link?: boolean; className?: string }) {
  const sizes = {
    sm: 'h-5 px-1.5 text-[12px]',
    md: 'h-6 px-2 text-[14px]',
    lg: 'h-8 px-2.5 text-[19px]',
    xl: 'h-11 px-3.5 text-[28px]',
  };
  const tag = (
    <span
      className={cn(
        't-condensed t-num inline-flex items-center rounded-[4px] bg-paint leading-none font-extrabold tracking-tight text-asphalt shadow-[inset_0_-2px_0_rgba(0,0,0,0.12)]',
        sizes[size],
        className,
      )}
    >
      <span className="mr-[1px] opacity-60">#</span>
      {id}
    </span>
  );
  if (!link) return tag;
  return (
    <Link to={`/vehicles/${id}`} className="rounded-[4px] hover:brightness-105" aria-label={`Open vehicle ${id}`}>
      {tag}
    </Link>
  );
}
