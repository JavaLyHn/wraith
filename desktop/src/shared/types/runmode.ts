/** RunMode + plan-execute + multi-agent team event streams. */

export type RunMode = 'react' | 'plan' | 'team'

/** 计划步骤视图(mirrors Java PlanStep). */
export interface PlanStepView { id: string; description: string; deps: string[] }

/** plan.created 通知负载。 */
export interface PlanCreatedEvent { planId: string; goal: string; steps: PlanStepView[] }

/** plan.step.started 通知负载。 */
export interface PlanStepStartedEvent { planId: string; stepId: string }

/** plan.step.completed 通知负载。 */
export interface PlanStepCompletedEvent { planId: string; stepId: string; ok: boolean; result?: string }

/** plan.review.requested 通知负载。 */
export interface PlanReviewRequestedEvent { reviewId: string; planId: string; goal: string; steps: PlanStepView[] }

/** plan.step.output 通知负载（步骤流式正文片段，嵌套在清单步骤行下方）。 */
export interface PlanStepOutputEvent { planId: string; stepId: string; text: string }

/** plan.output 通知负载（规划器"生成计划"阶段的流式正文，plan.created 到达前的空窗期）。 */
export interface PlanOutputEvent { planId: string; text: string }

// ---------------------------------------------------------------------------
// Team mode: 多智能体运行模式 + 团队事件负载(Java TeamMode / Team* 通知的前端镜像)
// ---------------------------------------------------------------------------

/** team.started 通知负载。 */
export interface TeamStartedEvent { teamId: string; goal: string; agents: { id: string; role: string }[] }

/** 团队步骤视图(mirrors Java TeamStep). */
export interface TeamStepView { id: string; description: string; type: string; dependencies: string[] }

/** team.plan 通知负载。 */
export interface TeamPlanEvent { teamId: string; steps: TeamStepView[] }

/** team.batch 通知负载。 */
export interface TeamBatchEvent { teamId: string; batchIndex: number; stepIds: string[] }

/** team.step.started 通知负载。 */
export interface TeamStepStartedEvent { teamId: string; stepId: string; agent: string }

/** team.step.completed 通知负载。 */
export interface TeamStepCompletedEvent { teamId: string; stepId: string; status: string; result: string; approved: boolean; retries: number }

/** team.finished 通知负载。 */
export interface TeamFinishedEvent { teamId: string; status: string }

/** team.plan.output 通知负载（规划器流式正文片段）。 */
export interface TeamPlanOutputEvent { teamId: string; text: string }

/** team.step.output 通知负载（步骤流式正文片段）。 */
export interface TeamStepOutputEvent { teamId: string; stepId: string; text: string }

/** team.review.output 通知负载（审评流式正文片段）。 */
export interface TeamReviewOutputEvent { teamId: string; stepId: string; text: string }
