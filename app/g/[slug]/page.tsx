import RecipientPageClient from '../../../components/RecipientPageClient';

export default async function ShareGiftPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <RecipientPageClient slug={decodeURIComponent(slug)} />;
}
