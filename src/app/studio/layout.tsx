import { AssistantProvider } from "@/components/assistant";
export default function StudioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AssistantProvider
      streamEnabled={process.env.ASSISTANT_STREAM_ENABLED !== "false"}
    >
      {children}
    </AssistantProvider>
  );
}
