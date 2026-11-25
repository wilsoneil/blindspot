import { MixedModePage } from "../mixed-page";

export default async function SurvivalPage({ searchParams }: PageProps<"/train/survival">) {
  const { tc } = await searchParams;
  return <MixedModePage mode="survival" tc={typeof tc === "string" ? tc : undefined} />;
}
