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
    fallback: { en: "Ask about saved fields and their management context. Check the field workspace for current records.", "zh-CN": "可询问已保存地块及管理背景；最新记录请以地块工作区为准。" },
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
    fallback: { en: "Discuss available water observations and their limits; missing readings remain unavailable.", "zh-CN": "可讨论已有水分观测及局限；缺失的读数仍无法提供。" },
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
    fallback: { en: "Discuss available soil observations and their limits; missing readings remain unavailable.", "zh-CN": "可讨论已有土壤观测及局限；缺失的读数仍无法提供。" },
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
    fallback: { en: "Discuss available weather observations. This chat does not provide a live forecast.", "zh-CN": "可讨论已有天气观测；此对话不提供实时预报。" },
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
    fallback: { en: "Ask about sourced local knowledge. Prices and crop varieties are examples, not live local data.", "zh-CN": "可询问有来源的本地知识；价格与品种为示例，并非实时本地数据。" },
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
    fallback: { en: "Discuss rotation trade-offs here; open the planning workspace for a saved plan.", "zh-CN": "可在此讨论轮作取舍；已保存的方案请到规划工作区查看。" },
  },
];

export function botsForModule(module: SiBotModule): CatalogBot[] {
  return botCatalog.filter((bot) => bot.module === module);
}
