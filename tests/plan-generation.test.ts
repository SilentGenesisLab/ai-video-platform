import { describe, expect, test } from "vitest";
import { authorizePlanBridge, generatedPlan } from "../src/lib/plan-generation";
import { planWorkflow } from "../scripts/plan-workflow";
describe("plan workflow safety", () => {
  test("bridge requires exact configured secret", () => {
    process.env.N8N_PLAN_SECRET = "private-test-secret";
    expect(() => authorizePlanBridge(null)).toThrow();
    expect(() => authorizePlanBridge("wrong-test-secret!")).toThrow();
    expect(() => authorizePlanBridge("private-test-secret")).not.toThrow();
  });
  test("incomplete plans cannot be saved as successful output", () => {
    expect(
      generatedPlan.safeParse({ title: "test", content: {} }).success,
    ).toBe(false);
    expect(
      generatedPlan.safeParse({
        title: "test",
        content: {
          story: "story",
          body: "full treatment",
          duration: 45,
          aspectRatio: "16:9",
        },
      }).success,
    ).toBe(true);
    expect(
      generatedPlan.safeParse({
        title: "test",
        content: { story: "story", body: "body", duration: -1 },
      }).success,
    ).toBe(false);
  });
  test("webhook protected, every error output wired, model call never auto retried", () => {
    const workflow = planWorkflow("test-credential");
    expect(workflow.nodes[0].parameters.authentication).toBe("headerAuth");
    for (const node of workflow.nodes.filter((n) => (n as any).onError))
      expect(
        (workflow.connections as any)[node.name].main[1].length,
      ).toBeGreaterThan(0);
    const model = workflow.nodes.find((n) => n.name === "DeepSeek生成策划案")!;
    expect((model as any).retryOnFail).not.toBe(true);
    expect(JSON.stringify(workflow)).not.toContain("private-test-secret");
    expect(workflow.settings.saveDataSuccessExecution).toBe("none");
  });
});
