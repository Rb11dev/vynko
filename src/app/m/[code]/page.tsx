import MeetingExperience from '@/components/MeetingExperience';

export const metadata = { title: 'Meeting · VYNKO' };

export default async function MeetingPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return <MeetingExperience code={code} />;
}
