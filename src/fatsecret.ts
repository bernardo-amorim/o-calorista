import * as cheerio from "cheerio";
import OpenAI from "openai";
import type {
  FoodSearchResult,
  NutritionalValues,
  FoodNutritionalResponse,
  ServingInfo,
  FoodItem,
  AggregateNutritionalValues,
  AggregateNutritionalResponse,
  AggregatedFoodItemDetail,
} from "./types";

const FATSECRET_BASE_URL = "https://www.fatsecret.com.br";
const FATSECRET_SEARCH_PATH = "/calorias-nutrição/search";

/**
 * Parses the search results page from FatSecret and extracts the top food items
 */
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

    // Parse nutritional info from the text like:
    // "por 100 g - Calorias: 212kcal | Gord: 10,85g | Carbs: 0,0g | Prot: 26,77g"
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

  return results.slice(0, 10); // Return top 10 results
}

/**
 * Schema for the structured output from OpenAI
 */
interface FoodSelectionResponse {
  foodItem: number;
}

/**
 * Uses OpenAI to select the best matching food item from search results
 * Uses structured outputs to ensure a valid JSON response
 */
async function selectBestMatch(
  foodName: string,
  searchResults: FoodSearchResult[],
  openai: OpenAI
): Promise<FoodSearchResult> {
  if (searchResults.length === 0) {
    throw new Error(`No search results found for "${foodName}"`);
  }

  if (searchResults.length === 1) {
    return searchResults[0];
  }

  const resultsDescription = searchResults
    .map((r, i) => {
      const brandInfo = r.brand ? ` (${r.brand})` : "";
      return `${i + 1}. ${r.name}${brandInfo} - ${r.caloriesPer100g} kcal, ${r.fatPer100g}g gordura, ${r.carbsPer100g}g carboidratos, ${r.proteinPer100g}g proteína`;
    })
    .join("\n");

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `Você é um assistente especializado em nutrição que ajuda a identificar alimentos em uma base de dados nutricional.
Sua tarefa é selecionar o item que melhor corresponde à busca do usuário.
Priorize alimentos genéricos (sem marca) quando o usuário não especificar uma marca.`,
      },
      {
        role: "user",
        content: `O usuário está procurando informações nutricionais sobre: "${foodName}"

Aqui estão os resultados da busca:
${resultsDescription}

Qual número de item (1-${searchResults.length}) melhor corresponde à busca do usuário?`,
      },
    ],
    temperature: 0,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "food_selection",
        strict: true,
        schema: {
          type: "object",
          properties: {
            foodItem: {
              type: "number",
              description: "The number (1-indexed) of the food item that best matches the user's search query",
            },
          },
          required: ["foodItem"],
          additionalProperties: false,
        },
      },
    },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    return searchResults[0];
  }

  try {
    const parsed: FoodSelectionResponse = JSON.parse(content);
    const selectedIndex = parsed.foodItem - 1;

    if (selectedIndex < 0 || selectedIndex >= searchResults.length) {
      return searchResults[0];
    }

    return searchResults[selectedIndex];
  } catch {
    // Default to first result if parsing fails
    return searchResults[0];
  }
}

/**
 * Extracts available serving options from the food detail page
 * These are typically shown in a table with quantities like "100g", "1 porção (120g)", "1 xícara"
 */
function extractServingOptions(html: string): string[] {
  const $ = cheerio.load(html);
  const servings: string[] = [];

  // Look for the common quantities table
  $("table.generic tr").each((_, row) => {
    const $row = $(row);
    const $link = $row.find("a");
    const text = $link.text().trim();
    const calories = $row.find("td").last().text().trim();

    if (text && calories) {
      // Include the grams info if present
      const gramsInfo = $row.find(".smallText.greyText").text().trim();
      const fullText = gramsInfo ? `${text} ${gramsInfo} - ${calories} kcal` : `${text} - ${calories} kcal`;
      servings.push(fullText);
    }
  });

  // Also extract from the nutrition facts summary
  const summaryText = $(".factPanel").text();
  if (summaryText) {
    // Look for patterns like "Existem 156 calorias em Carne Moída (100 g)"
    const match = summaryText.match(/Existem\s+([\d,]+)\s+calorias?\s+em\s+.+?\s+\(([^)]+)\)/i);
    if (match) {
      servings.unshift(`Base: ${match[2]} - ${match[1]} kcal`);
    }
  }

  return servings;
}

/**
 * Schema for the serving size calculation response from OpenAI
 */
interface ServingSizeResponse {
  gramsAmount: number;
}

/**
 * Uses OpenAI to interpret the user's serving description and convert it to grams
 */
async function calculateServingSize(
  foodName: string,
  userServing: string,
  foodPageHtml: string,
  openai: OpenAI
): Promise<number> {
  const servingOptions = extractServingOptions(foodPageHtml);
  const $ = cheerio.load(foodPageHtml);
  
  // Extract the nutrition facts section as context
  const nutritionFactsText = $(".nutrition_facts").text().trim();
  const servingInfoText = $(".factPanel").text().trim();

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `Você é um assistente especializado em nutrição que ajuda a converter porções de alimentos para gramas.
Sua tarefa é interpretar a descrição de porção fornecida pelo usuário e calcular o peso em gramas.

Use seu conhecimento sobre porções típicas de alimentos e as informações da página nutricional para fazer a conversão.
Considere medidas comuns como:
- 1 colher de sopa = ~15g (varia por alimento)
- 1 colher de chá = ~5g
- 1 xícara = ~240ml ou peso específico do alimento
- 1 porção geralmente = 100-150g
- Pratos "cheios" ou "fartos" = 200-300g

Sempre retorne um número em gramas, mesmo que seja uma estimativa.`,
      },
      {
        role: "user",
        content: `Alimento: ${foodName}

Porção solicitada pelo usuário: "${userServing}"

Informações da página nutricional:
${servingInfoText.substring(0, 500)}

Opções de porção disponíveis na página:
${servingOptions.join("\n")}

Qual é o peso em gramas da porção "${userServing}"?`,
      },
    ],
    temperature: 0,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "serving_size",
        strict: true,
        schema: {
          type: "object",
          properties: {
            gramsAmount: {
              type: "number",
              description: "The weight of the serving in grams",
            },
          },
          required: ["gramsAmount"],
          additionalProperties: false,
        },
      },
    },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    // Default to 100g if no response
    return 100;
  }

  try {
    const parsed: ServingSizeResponse = JSON.parse(content);
    return parsed.gramsAmount > 0 ? parsed.gramsAmount : 100;
  } catch {
    return 100;
  }
}

/**
 * Scales nutritional values by a multiplier (based on serving size)
 */
function scaleNutritionalValues(
  values: NutritionalValues,
  multiplier: number
): NutritionalValues {
  const round = (n: number) => Math.round(n * 100) / 100;

  return {
    ...values,
    energy: {
      kj: round(values.energy.kj * multiplier),
      kcal: round(values.energy.kcal * multiplier),
    },
    carbohydrates: round(values.carbohydrates * multiplier),
    sugar: round(values.sugar * multiplier),
    protein: round(values.protein * multiplier),
    fat: {
      total: round(values.fat.total * multiplier),
      saturated: round(values.fat.saturated * multiplier),
      trans: round(values.fat.trans * multiplier),
      monounsaturated: round(values.fat.monounsaturated * multiplier),
      polyunsaturated: round(values.fat.polyunsaturated * multiplier),
    },
    cholesterol: round(values.cholesterol * multiplier),
    fiber: round(values.fiber * multiplier),
    sodium: round(values.sodium * multiplier),
    potassium: round(values.potassium * multiplier),
  };
}

/**
 * Parses the food detail page and extracts nutritional values
 */
function parseNutritionalValues(html: string, foodName: string): NutritionalValues {
  const $ = cheerio.load(html);

  // Helper to parse numbers in Brazilian format (comma as decimal separator)
  const parseNumber = (text: string): number => {
    const cleaned = text.replace(/[^\d,.-]/g, "").replace(",", ".");
    return parseFloat(cleaned) || 0;
  };

  // Get the food name from the page
  const pageName = $("h1").text().trim() || foodName;

  // Get serving size
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
  // Looks for .nutrient.left or .nutrient.black.left containing the label
  // then finds the next sibling with .tRight class
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
    energy: {
      kj: energyKj,
      kcal: energyKcal,
    },
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

/**
 * Options for getFoodNutritionalValues
 */
export interface GetFoodNutritionalValuesOptions {
  /** The name of the food in Brazilian Portuguese */
  foodName: string;
  /** Optional serving size description in Portuguese (e.g., "2 colheres de sopa", "150g", "1 prato") */
  serving?: string;
  /** Optional OpenAI API key (defaults to OPENAI_API_KEY env var) */
  openaiApiKey?: string;
}

/**
 * Fetches nutritional values for a food item from FatSecret Brazil
 *
 * @param options - Options including foodName, optional serving size, and optional API key
 * @returns The nutritional values for the best matching food item, scaled to the serving size if provided
 */
export async function getFoodNutritionalValues(
  options: GetFoodNutritionalValuesOptions
): Promise<FoodNutritionalResponse>;

/**
 * Fetches nutritional values for a food item from FatSecret Brazil (legacy signature)
 *
 * @param foodName - The name of the food in Brazilian Portuguese
 * @param openaiApiKey - Optional OpenAI API key (defaults to OPENAI_API_KEY env var)
 * @returns The nutritional values for the best matching food item
 * @deprecated Use the options object signature instead
 */
export async function getFoodNutritionalValues(
  foodName: string,
  openaiApiKey?: string
): Promise<FoodNutritionalResponse>;

export async function getFoodNutritionalValues(
  optionsOrFoodName: GetFoodNutritionalValuesOptions | string,
  legacyApiKey?: string
): Promise<FoodNutritionalResponse> {
  // Handle both signatures
  const options: GetFoodNutritionalValuesOptions =
    typeof optionsOrFoodName === "string"
      ? { foodName: optionsOrFoodName, openaiApiKey: legacyApiKey }
      : optionsOrFoodName;

  const { foodName, serving, openaiApiKey } = options;

  const openai = new OpenAI({
    apiKey: openaiApiKey || process.env.OPENAI_API_KEY,
  });

  // Step 1: Search for food items
  const searchUrl = `${FATSECRET_BASE_URL}${FATSECRET_SEARCH_PATH}?q=${encodeURIComponent(foodName)}`;
  
  const searchResponse = await fetch(searchUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    },
  });

  if (!searchResponse.ok) {
    throw new Error(`Failed to fetch search results: ${searchResponse.status} ${searchResponse.statusText}`);
  }

  const searchHtml = await searchResponse.text();
  const searchResults = parseSearchResults(searchHtml);

  if (searchResults.length === 0) {
    throw new Error(`No food items found for "${foodName}"`);
  }

  // Step 2: Use OpenAI to select the best match
  const bestMatch = await selectBestMatch(foodName, searchResults, openai);

  // Step 3: Fetch and parse the food detail page
  const foodPageResponse = await fetch(bestMatch.url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    },
  });

  if (!foodPageResponse.ok) {
    throw new Error(`Failed to fetch food page: ${foodPageResponse.status} ${foodPageResponse.statusText}`);
  }

  const foodPageHtml = await foodPageResponse.text();
  let nutritionalValues = parseNutritionalValues(foodPageHtml, bestMatch.name);

  // Step 4: If serving is specified, calculate the serving size and scale nutritional values
  let servingInfo: ServingInfo | undefined;
  
  if (serving) {
    const gramsAmount = await calculateServingSize(foodName, serving, foodPageHtml, openai);
    const multiplier = gramsAmount / 100; // Base values are per 100g
    
    nutritionalValues = scaleNutritionalValues(nutritionalValues, multiplier);
    nutritionalValues.servingSize = `${gramsAmount}g (${serving})`;
    
    servingInfo = {
      userServing: serving,
      gramsAmount,
      multiplier,
    };
  }

  return {
    searchQuery: foodName,
    selectedFood: bestMatch.name,
    nutritionalValues,
    sourceUrl: bestMatch.url,
    ...(servingInfo && { serving: servingInfo }),
  };
}

/**
 * Searches for food items without selecting one (useful for debugging)
 */
export async function searchFoods(foodName: string): Promise<FoodSearchResult[]> {
  const searchUrl = `${FATSECRET_BASE_URL}${FATSECRET_SEARCH_PATH}?q=${encodeURIComponent(foodName)}`;
  
  const searchResponse = await fetch(searchUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    },
  });

  if (!searchResponse.ok) {
    throw new Error(`Failed to fetch search results: ${searchResponse.status} ${searchResponse.statusText}`);
  }

  const searchHtml = await searchResponse.text();
  return parseSearchResults(searchHtml);
}

/**
 * Creates an empty aggregate nutritional values object
 */
function createEmptyAggregate(): AggregateNutritionalValues {
  return {
    energy: { kj: 0, kcal: 0 },
    carbohydrates: 0,
    sugar: 0,
    protein: 0,
    fat: {
      total: 0,
      saturated: 0,
      trans: 0,
      monounsaturated: 0,
      polyunsaturated: 0,
    },
    cholesterol: 0,
    fiber: 0,
    sodium: 0,
    potassium: 0,
  };
}

/**
 * Adds nutritional values to an aggregate
 */
function addToAggregate(
  aggregate: AggregateNutritionalValues,
  values: NutritionalValues
): void {
  aggregate.energy.kj += values.energy.kj;
  aggregate.energy.kcal += values.energy.kcal;
  aggregate.carbohydrates += values.carbohydrates;
  aggregate.sugar += values.sugar;
  aggregate.protein += values.protein;
  aggregate.fat.total += values.fat.total;
  aggregate.fat.saturated += values.fat.saturated;
  aggregate.fat.trans += values.fat.trans;
  aggregate.fat.monounsaturated += values.fat.monounsaturated;
  aggregate.fat.polyunsaturated += values.fat.polyunsaturated;
  aggregate.cholesterol += values.cholesterol;
  aggregate.fiber += values.fiber;
  aggregate.sodium += values.sodium;
  aggregate.potassium += values.potassium;
}

/**
 * Rounds all values in an aggregate to 2 decimal places
 */
function roundAggregate(aggregate: AggregateNutritionalValues): AggregateNutritionalValues {
  const round = (n: number) => Math.round(n * 100) / 100;
  
  return {
    energy: {
      kj: round(aggregate.energy.kj),
      kcal: round(aggregate.energy.kcal),
    },
    carbohydrates: round(aggregate.carbohydrates),
    sugar: round(aggregate.sugar),
    protein: round(aggregate.protein),
    fat: {
      total: round(aggregate.fat.total),
      saturated: round(aggregate.fat.saturated),
      trans: round(aggregate.fat.trans),
      monounsaturated: round(aggregate.fat.monounsaturated),
      polyunsaturated: round(aggregate.fat.polyunsaturated),
    },
    cholesterol: round(aggregate.cholesterol),
    fiber: round(aggregate.fiber),
    sodium: round(aggregate.sodium),
    potassium: round(aggregate.potassium),
  };
}

/**
 * Options for getAggregateNutritionalValues
 */
export interface GetAggregateNutritionalValuesOptions {
  /** List of food items with their serving sizes */
  items: FoodItem[];
  /** Optional OpenAI API key (defaults to OPENAI_API_KEY env var) */
  openaiApiKey?: string;
}

/**
 * Fetches and aggregates nutritional values for a list of food items
 *
 * @param options - Options including the list of food items and optional API key
 * @returns Aggregate nutritional values for all items combined
 *
 * @example
 * ```typescript
 * const result = await getAggregateNutritionalValues({
 *   items: [
 *     { foodName: "arroz branco", serving: "2 colheres de sopa" },
 *     { foodName: "feijão", serving: "1 concha" },
 *     { foodName: "frango grelhado", serving: "1 filé médio" },
 *   ]
 * });
 * console.log(result.totals.energy.kcal); // Total calories
 * ```
 */
export async function getAggregateNutritionalValues(
  options: GetAggregateNutritionalValuesOptions
): Promise<AggregateNutritionalResponse> {
  const { items, openaiApiKey } = options;

  if (items.length === 0) {
    return {
      itemCount: 0,
      totalGrams: 0,
      totals: createEmptyAggregate(),
      items: [],
    };
  }

  const aggregate = createEmptyAggregate();
  const itemDetails: AggregatedFoodItemDetail[] = [];
  let totalGrams = 0;

  // Process all items (could be parallelized, but sequential is safer for rate limits)
  for (const item of items) {
    const result = await getFoodNutritionalValues({
      foodName: item.foodName,
      serving: item.serving,
      openaiApiKey,
    });

    const gramsAmount = result.serving?.gramsAmount ?? 100;
    totalGrams += gramsAmount;

    // Add to aggregate
    addToAggregate(aggregate, result.nutritionalValues);

    // Store item details
    itemDetails.push({
      foodName: item.foodName,
      selectedFood: result.selectedFood,
      serving: item.serving,
      gramsAmount,
      nutritionalValues: result.nutritionalValues,
      sourceUrl: result.sourceUrl,
    });
  }

  return {
    itemCount: items.length,
    totalGrams: Math.round(totalGrams * 100) / 100,
    totals: roundAggregate(aggregate),
    items: itemDetails,
  };
}
