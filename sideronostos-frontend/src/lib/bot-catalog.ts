import type { Locale } from "@/lib/i18n/locale";
import type { BotAvatarVariant } from "@/lib/bot";

export type SiBotModule =
  | "field-management"
  | "remote-sensing"
  | "local-knowledge"
  | "rotation-recommendation";

export type CatalogBot = {
  id: string;
  module: SiBotModule;
  presetId: string;
  avatar: BotAvatarVariant;
  color: string;
  name: Record<Locale, string>;
  shortName: Record<Locale, string>;
  capability: Record<Locale, string>;
  fallback: Record<Locale, string>;
};

export const botCatalog: readonly CatalogBot[] = [
  {
    id: "field-guide",
    module: "field-management",
    presetId: "field_management",
    avatar: "field",
    color: "#4d9b75",
    name: { en: "Field guide", "zh-CN": "地块助手" },
    shortName: { en: "Fields", "zh-CN": "地块" },
    capability: { en: "Saved field details and management context", "zh-CN": "地块资料与管理信息" },
    fallback: { en: "Field chat is not connected yet. Your field data remains available in the existing field workspace.", "zh-CN": "地块对话尚未接入。现有地块工作区仍可查看地块资料。" },
  },
  {
    id: "remote-water",
    module: "remote-sensing",
    presetId: "remote_sensing",
    avatar: "water",
    color: "#4b96b8",
    name: { en: "Water specialist", "zh-CN": "水分助手" },
    shortName: { en: "Water", "zh-CN": "水分" },
    capability: { en: "Water observations and their data limits", "zh-CN": "水分观测与数据局限" },
    fallback: { en: "Water chat is not connected yet. No water analysis is being run here.", "zh-CN": "水分对话尚未接入；此处不会运行水分分析。" },
  },
  {
    id: "remote-soil",
    module: "remote-sensing",
    presetId: "remote_sensing",
    avatar: "soil",
    color: "#ab8765",
    name: { en: "Soil specialist", "zh-CN": "土壤助手" },
    shortName: { en: "Soil", "zh-CN": "土壤" },
    capability: { en: "Soil observations and their data limits", "zh-CN": "土壤观测与数据局限" },
    fallback: { en: "Soil chat is not connected yet. No soil analysis is being run here.", "zh-CN": "土壤对话尚未接入；此处不会运行土壤分析。" },
  },
  {
    id: "remote-weather",
    module: "remote-sensing",
    presetId: "remote_sensing",
    avatar: "weather",
    color: "#728db9",
    name: { en: "Weather specialist", "zh-CN": "天气助手" },
    shortName: { en: "Weather", "zh-CN": "天气" },
    capability: { en: "Weather observations and their data limits", "zh-CN": "天气观测与数据局限" },
    fallback: { en: "Weather chat is not connected yet. No forecast is being run here.", "zh-CN": "天气对话尚未接入；此处不会生成预报。" },
  },
  {
    id: "local-knowledge-guide",
    module: "local-knowledge",
    presetId: "local_agriculture",
    avatar: "knowledge",
    color: "#ca9a4e",
    name: { en: "Local knowledge", "zh-CN": "本地知识助手" },
    shortName: { en: "Local", "zh-CN": "本地" },
    capability: { en: "Sourced local rules and agricultural knowledge", "zh-CN": "有来源的本地规则与农业知识" },
    fallback: { en: "Local knowledge chat is not connected yet. No source lookup is being run here.", "zh-CN": "本地知识对话尚未接入；此处不会检索来源。" },
  },
  {
    id: "rotation-guide",
    module: "rotation-recommendation",
    presetId: "rotation",
    avatar: "rotation",
    color: "#8671d9",
    name: { en: "Rotation guide", "zh-CN": "轮作助手" },
    shortName: { en: "Rotation", "zh-CN": "轮作" },
    capability: { en: "Rotation plans and farm trade-offs", "zh-CN": "轮作方案与经营取舍" },
    fallback: { en: "Rotation chat exists in the planning workspace, but this SI page is not connected yet.", "zh-CN": "轮作对话已在规划工作区提供，但此 SI 页面尚未接入。" },
  },
];

export function botsForModule(module: SiBotModule): CatalogBot[] {
  return botCatalog.filter((bot) => bot.module === module);
}
