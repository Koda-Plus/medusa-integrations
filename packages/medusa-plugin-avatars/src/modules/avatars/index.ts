import { Module } from "@medusajs/framework/utils"
import AvatarsModuleService from "./service"
import { AVATARS_MODULE } from "./lib/constants"

/**
 * AI Avatars module: avatars with the written consent of the person,
 * presentations made from a recording or a text (script, slides, quiz) and
 * the render jobs of their clips.
 */
export { AVATARS_MODULE }
export type { AvatarsPluginOptions } from "./lib/options"
export type { AvatarDto, PresentationDto, RenderJobDto, StatusResponse } from "./lib/contract"

export default Module(AVATARS_MODULE, {
  service: AvatarsModuleService,
})
