import { Link } from "react-router";
import { btn, pageTitle } from "../components/ui";

export function NotFoundPage() {
  return (
    <div className="flex flex-col items-center gap-4 py-16 text-center">
      <p className="text-sm font-semibold text-muted">404</p>
      <h1 className={pageTitle}>페이지를 찾을 수 없습니다</h1>
      <p className="text-sm text-muted">주소가 잘못되었거나, 삭제되었거나, 볼 수 없는 내용입니다.</p>
      <Link to="/" className={btn.secondary}>
        홈으로
      </Link>
    </div>
  );
}
