import { Link } from 'react-router-dom';
import { Button } from '../components/ui';

export default function NotFoundPage() {
  return (
    <div className="flex flex-col items-center py-24 text-center">
      <p className="t-condensed rounded-[4px] bg-paint px-3 py-1 text-3xl font-extrabold text-asphalt">#404</p>
      <h1 className="t-display mt-6 text-3xl">This stall is empty</h1>
      <p className="mt-2 max-w-sm text-muted">The page you were looking for does not exist or has moved.</p>
      <Link to="/" className="mt-6">
        <Button>Back to LotFlow</Button>
      </Link>
    </div>
  );
}
