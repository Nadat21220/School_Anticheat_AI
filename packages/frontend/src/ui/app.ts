import { mountLobby, type LobbyVerifiedContext } from "./lobby.js";
import { mountExam } from "./exam.js";

export function mountApp(root: HTMLElement): void {
  mountLobby(root, (ctx: LobbyVerifiedContext) => mountExam(root, ctx));
}
