/** 规则裁定配置：所有存在变体的规则统一收口于此，禁止散落 if */

export interface RulesConfig {
  /** R2 裸钢板（连三不带对子）是否允许，默认允许 */
  allowBareSteel: boolean;
  /** R5 双小王/双大王是否算普通对子，默认算 */
  allowJokerPair: boolean;
  /** R4 三带二/钢板的附带对子可否为王对，默认禁止 */
  allowJokerAttachment: boolean;
  /** R1 本局级数取法：较高队伍级数（默认）或上局胜方级数 */
  levelPolicy: 'higher' | 'winner';
  /** R6 过 A 条件：打 A 时任一胜（默认）或须双下 */
  passA: 'any' | 'doubleDown';
  /** R9 贡牌/还贡是否对所有人公开（默认公开） */
  revealTribute: boolean;
  /** 升级档：双下/头游三游/头游末游 各升几级（官方 3/2/1） */
  levelUps: { doubleDown: number; oneThree: number; oneFour: number };
}

export const DEFAULT_RULES: RulesConfig = {
  allowBareSteel: true,
  allowJokerPair: true,
  allowJokerAttachment: false,
  levelPolicy: 'higher',
  passA: 'any',
  revealTribute: true,
  levelUps: { doubleDown: 3, oneThree: 2, oneFour: 1 },
};
