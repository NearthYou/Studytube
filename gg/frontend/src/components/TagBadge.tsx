import { Badge } from '@/components/ui/badge';

export function TagBadge({ name }: { name: string }) {
  return <Badge variant="secondary">#{name}</Badge>;
}
