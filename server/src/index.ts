export { getFoodNutritionalValues, getAggregateNutritionalValues, searchFoods } from "./fatsecret";
export type { GetFoodNutritionalValuesOptions, GetAggregateNutritionalValuesOptions } from "./fatsecret";
export type {
  NutritionalValues,
  FoodSearchResult,
  FoodNutritionalResponse,
  ServingInfo,
  FoodItem,
  AggregateNutritionalValues,
  AggregateNutritionalResponse,
  AggregatedFoodItemDetail,
} from "./types";

// Example usage when running directly
// Usage: bun run lookup <foodName> [serving]
// Example: bun run lookup "arroz branco" "2 colheres de sopa"
async function main() {
  const foodName = process.argv[2] || "carne moída";
  const serving = process.argv[3];

  console.log(`🔍 Searching for nutritional information: "${foodName}"`);
  if (serving) {
    console.log(`📏 Serving size: "${serving}"`);
  }
  console.log();

  try {
    const { getFoodNutritionalValues } = await import("./fatsecret");
    const result = await getFoodNutritionalValues({ foodName, serving });

    console.log("✅ Found food:", result.selectedFood);
    console.log("📊 Source:", result.sourceUrl);
    
    if (result.serving) {
      console.log(`📏 Calculated serving: ${result.serving.gramsAmount}g (${result.serving.multiplier.toFixed(2)}x base)`);
    }
    
    console.log("\n📋 Nutritional Values (per", result.nutritionalValues.servingSize + "):");
    console.log("─".repeat(50));

    const nv = result.nutritionalValues;
    console.log(`  Energia:        ${nv.energy.kcal} kcal (${nv.energy.kj} kJ)`);
    console.log(`  Carboidratos:   ${nv.carbohydrates}g`);
    console.log(`    └─ Açúcar:    ${nv.sugar}g`);
    console.log(`  Proteínas:      ${nv.protein}g`);
    console.log(`  Gorduras:       ${nv.fat.total}g`);
    console.log(`    ├─ Saturada:  ${nv.fat.saturated}g`);
    console.log(`    ├─ Trans:     ${nv.fat.trans}g`);
    console.log(`    ├─ Mono:      ${nv.fat.monounsaturated}g`);
    console.log(`    └─ Poli:      ${nv.fat.polyunsaturated}g`);
    console.log(`  Colesterol:     ${nv.cholesterol}mg`);
    console.log(`  Fibras:         ${nv.fiber}g`);
    console.log(`  Sódio:          ${nv.sodium}mg`);
    console.log(`  Potássio:       ${nv.potassium}mg`);
  } catch (error) {
    console.error("❌ Error:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Run main if this file is executed directly
if (import.meta.main) {
  main();
}
