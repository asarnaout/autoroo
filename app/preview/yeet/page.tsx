import { notFound } from 'next/navigation';
import { YeetPreview } from './YeetPreview';

/** Local review surface; this route is a 404 in production. */
export default function YeetPreviewPage() {
  if (process.env.NODE_ENV !== 'development') notFound();
  return <YeetPreview />;
}
