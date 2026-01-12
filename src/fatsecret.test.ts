import { describe, test, expect } from "bun:test";
import * as cheerio from "cheerio";
import { readFileSync } from "fs";
import { join } from "path";

// Import the parsing functions by re-implementing them here for testing
// (In a real scenario, you'd export these from fatsecret.ts)

interface FoodSearchResult {
  name: string;
  brand?: string;
  url: string;
  caloriesPer100g: number;
  fatPer100g: number;
  carbsPer100g: number;
  proteinPer100g: number;
}

interface NutritionalValues {
  name: string;
  servingSize: string;
  energy: { kj: number; kcal: number };
  carbohydrates: number;
  sugar: number;
  protein: number;
  fat: {
    total: number;
    saturated: number;
    trans: number;
    monounsaturated: number;
    polyunsaturated: number;
  };
  cholesterol: number;
  fiber: number;
  sodium: number;
  potassium: number;
}

const FATSECRET_BASE_URL = "https://www.fatsecret.com.br";

function parseSearchResults(html: string): FoodSearchResult[] {
  const $ = cheerio.load(html);
  const results: FoodSearchResult[] = [];

  $("table.searchResult tr").each((_, row) => {
    const $row = $(row);
    const $link = $row.find("a.prominent");
    const $brand = $row.find("a.brand");
    const $info = $row.find(".smallText.greyText");

    if ($link.length === 0) return;

    const name = $link.text().trim();
    const href = $link.attr("href");
    const brand = $brand.length > 0 ? $brand.text().replace(/[()]/g, "").trim() : undefined;

    if (!href) return;

    const infoText = $info.text();
    
    const caloriesMatch = infoText.match(/Calorias:\s*([\d,]+)\s*kcal/);
    const fatMatch = infoText.match(/Gord:\s*([\d,]+)\s*g/);
    const carbsMatch = infoText.match(/Carbs:\s*([\d,]+)\s*g/);
    const proteinMatch = infoText.match(/Prot:\s*([\d,]+)\s*g/);

    const parseNumber = (match: RegExpMatchArray | null): number => {
      if (!match) return 0;
      return parseFloat(match[1].replace(",", "."));
    };

    results.push({
      name,
      brand,
      url: href.startsWith("http") ? href : `${FATSECRET_BASE_URL}${href}`,
      caloriesPer100g: parseNumber(caloriesMatch),
      fatPer100g: parseNumber(fatMatch),
      carbsPer100g: parseNumber(carbsMatch),
      proteinPer100g: parseNumber(proteinMatch),
    });
  });

  return results.slice(0, 10);
}

function parseNutritionalValues(html: string, foodName: string): NutritionalValues {
  const $ = cheerio.load(html);

  const parseNumber = (text: string): number => {
    const cleaned = text.replace(/[^\d,.-]/g, "").replace(",", ".");
    return parseFloat(cleaned) || 0;
  };

  const pageName = $("h1").text().trim() || foodName;
  const servingSize = $(".nutrition_facts .serving_size_value").text().trim() || "100 g";

  let energyKj = 0;
  let energyKcal = 0;

  // Find energy values by looking for kj and kcal patterns in all .tRight elements
  $(".nutrition_facts .tRight").each((_, el) => {
    const text = $(el).text();
    if (text.includes("kj")) {
      energyKj = parseNumber(text);
    } else if (text.includes("kcal")) {
      energyKcal = parseNumber(text);
    }
  });

  // Helper to find nutrient value by label (for main nutrients)
  const findNutrient = (label: string): number => {
    let value = 0;
    $(".nutrition_facts .nutrient").each((_, el) => {
      const $el = $(el);
      const hasLeft = $el.hasClass("left");
      const text = $el.text().toLowerCase();
      
      // Only match main nutrients (with "left" class but not "sub")
      if (hasLeft && !$el.hasClass("sub") && text.includes(label.toLowerCase())) {
        // Find the next element with tRight class
        const $next = $el.next();
        if ($next.hasClass("tRight")) {
          value = parseNumber($next.text());
        }
      }
    });
    return value;
  };

  // Helper to find sub-nutrient value (for nutrients with class "sub")
  // Uses exact matching to avoid "saturada" matching "monoinsaturada" etc.
  const findSubNutrient = (label: string): number => {
    let value = 0;
    $(".nutrition_facts .nutrient.sub.left").each((_, el) => {
      const $el = $(el);
      const text = $el.text().toLowerCase().trim();
      const labelLower = label.toLowerCase();
      
      // For "saturada", we need to match "gordura saturada" but not "monoinsaturada" or "poliinsaturada"
      let isMatch = false;
      if (labelLower === "saturada") {
        isMatch = text === "gordura saturada";
      } else if (labelLower === "monoinsaturada") {
        isMatch = text.includes("monoinsaturada");
      } else if (labelLower === "poliinsaturada") {
        isMatch = text.includes("poliinsaturada");
      } else {
        isMatch = text.includes(labelLower);
      }
      
      if (isMatch) {
        // Find the next element with tRight class
        const $next = $el.next();
        if ($next.hasClass("tRight")) {
          value = parseNumber($next.text());
        }
      }
    });
    return value;
  };

  return {
    name: pageName,
    servingSize,
    energy: { kj: energyKj, kcal: energyKcal },
    carbohydrates: findNutrient("carboidrato"),
    sugar: findSubNutrient("açúcar"),
    protein: findNutrient("proteína"),
    fat: {
      total: findNutrient("gordura"),
      saturated: findSubNutrient("saturada"),
      trans: findSubNutrient("trans"),
      monounsaturated: findSubNutrient("monoinsaturada"),
      polyunsaturated: findSubNutrient("poliinsaturada"),
    },
    cholesterol: findNutrient("colesterol"),
    fiber: findNutrient("fibra"),
    sodium: findNutrient("sódio"),
    potassium: findNutrient("potássio"),
  };
}

describe("FatSecret Parser", () => {
  describe("parseSearchResults", () => {
    test("should parse search results from sample HTML", () => {
      const sampleHtml = readFileSync(join(import.meta.dir, "../sample-search.html"), "utf-8");
      const results = parseSearchResults(sampleHtml);

      expect(results.length).toBeGreaterThan(0);
      expect(results.length).toBeLessThanOrEqual(10);

      // Check first result (Carne Moída Refogada)
      const firstResult = results[0];
      expect(firstResult.name).toBe("Carne Moída Refogada");
      expect(firstResult.caloriesPer100g).toBe(212);
      expect(firstResult.fatPer100g).toBe(10.85);
      expect(firstResult.carbsPer100g).toBe(0);
      expect(firstResult.proteinPer100g).toBe(26.77);
      expect(firstResult.url).toContain("fatsecret.com.br");

      // Check second result (Carne Moída)
      const secondResult = results[1];
      expect(secondResult.name).toBe("Carne Moída");
      expect(secondResult.caloriesPer100g).toBe(156);
      expect(secondResult.proteinPer100g).toBe(20.7);

      // Check branded result (Friboi)
      const friboiResult = results.find(r => r.brand === "Friboi");
      expect(friboiResult).toBeDefined();
      expect(friboiResult!.name).toBe("Carne Moída Patinho");
    });
  });

  describe("parseNutritionalValues", () => {
    test("should parse nutritional values from sample food page HTML", () => {
      const sampleHtml = readFileSync(join(import.meta.dir, "../sample-food-page.html"), "utf-8");
      const nutritionalValues = parseNutritionalValues(sampleHtml, "Carne Moída");

      expect(nutritionalValues.name).toBe("Carne Moída");
      expect(nutritionalValues.servingSize).toBe("100 g");
      expect(nutritionalValues.energy.kj).toBe(655);
      expect(nutritionalValues.energy.kcal).toBe(156);
      expect(nutritionalValues.carbohydrates).toBe(0);
      expect(nutritionalValues.protein).toBe(20.7);
      expect(nutritionalValues.fat.total).toBe(7.5);
      expect(nutritionalValues.fat.saturated).toBe(3.154);
      expect(nutritionalValues.fat.trans).toBe(0.49);
      expect(nutritionalValues.cholesterol).toBe(64);
      expect(nutritionalValues.sodium).toBe(66);
      expect(nutritionalValues.potassium).toBe(334);
    });
  });
});
