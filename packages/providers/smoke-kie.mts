/* V2-A real smoke: kie planner (1 chat completion). Run: PLANNER_PROVIDER=kie tsx scripts/smoke-planner-kie.mts */
import { createShotPlanProvider } from './src/index.js';

const planner = createShotPlanProvider();
console.log(`provider=${planner.name}`);

const result = await planner.draftPlan({
  sku: 'MUG-BLK-450',
  category: 'Kitchen > Drinkware',
  marketplace: 'US',
  confirmedFacts: [
    { key: 'brand', value: 'Acme' },
    { key: 'capacity', value: '450ml' },
    { key: 'material', value: '316 stainless steel' },
  ],
  intent: '主打 450ml 大容量和 18 小时保温；场景：办公桌、车载；风格干净明亮',
});

console.log(`model=${result.modelId} latency=${result.latencyMs}ms briefs=${result.briefs.length}`);
for (const b of result.briefs) {
  console.log(`#${b.orderIndex} ${b.slot} — ${b.purpose}`);
  if (b.copy.length) console.log(`   copy: ${b.copy.map((c) => c.text).join(' | ')}`);
}
