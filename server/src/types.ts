/**
 * Nutritional values for a food item (per 100g unless otherwise specified)
 */
export interface NutritionalValues {
  name: string;
  servingSize: string;
  energy: {
    kj: number;
    kcal: number;
  };
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

/**
 * A single food search result from FatSecret
 */
export interface FoodSearchResult {
  name: string;
  brand?: string;
  url: string;
  caloriesPer100g: number;
  fatPer100g: number;
  carbsPer100g: number;
  proteinPer100g: number;
}

/**
 * Information about the serving size used for calculations
 */
export interface ServingInfo {
  /** The original serving description provided by the user */
  userServing: string;
  /** The calculated weight in grams */
  gramsAmount: number;
  /** Multiplier applied to base nutritional values (gramsAmount / 100) */
  multiplier: number;
}

/**
 * Response from the getFoodNutritionalValues function
 */
export interface FoodNutritionalResponse {
  searchQuery: string;
  selectedFood: string;
  /** Nutritional values scaled to the requested serving size */
  nutritionalValues: NutritionalValues;
  sourceUrl: string;
  /** Information about the serving size (only present when serving is specified) */
  serving?: ServingInfo;
}

/**
 * A single food item in a meal list
 */
export interface FoodItem {
  /** The name of the food in Brazilian Portuguese */
  foodName: string;
  /** The serving size description in Portuguese (e.g., "2 colheres de sopa", "150g") */
  serving: string;
}

/**
 * Details about a single food item in the aggregate response
 */
export interface AggregatedFoodItemDetail {
  /** The original food name query */
  foodName: string;
  /** The matched food from FatSecret */
  selectedFood: string;
  /** The serving description provided */
  serving: string;
  /** Calculated grams amount */
  gramsAmount: number;
  /** Nutritional values for this item */
  nutritionalValues: NutritionalValues;
  /** Source URL from FatSecret */
  sourceUrl: string;
}

/**
 * Aggregate nutritional values (without name/servingSize since it's a total)
 */
export interface AggregateNutritionalValues {
  energy: {
    kj: number;
    kcal: number;
  };
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

/**
 * Response from the getAggregateNutritionalValues function
 */
export interface AggregateNutritionalResponse {
  /** Total number of items processed */
  itemCount: number;
  /** Total weight in grams */
  totalGrams: number;
  /** Aggregate nutritional values (sum of all items) */
  totals: AggregateNutritionalValues;
  /** Details for each individual food item */
  items: AggregatedFoodItemDetail[];
}
