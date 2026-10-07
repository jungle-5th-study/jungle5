import type { PostListItem } from "../../shared/api";
import { AuthorName, HiddenBadge, ListRow, MetaList, Time } from "./ui";

/** A knowledge row (UD-09): title, 2-line excerpt, category · author · time · #tags · 댓글 N · linked round. */
export function PostRow({
  post,
  showCategory = true,
  showExcerpt = true,
  compact = false,
  hideRound = false,
}: {
  post: PostListItem;
  showCategory?: boolean;
  showExcerpt?: boolean;
  compact?: boolean;
  /** On the round page itself the round is implied. */
  hideRound?: boolean;
}) {
  return (
    <ListRow
      to={`/posts/${post.id}`}
      title={post.title}
      excerpt={showExcerpt ? post.excerpt : undefined}
      compact={compact}
      badge={post.hidden ? <HiddenBadge /> : undefined}
      meta={
        <MetaList
          items={[
            showCategory && post.category.name,
            <AuthorName key="a" author={post.author} />,
            <Time key="t" ms={post.createdAt} />,
            post.tags.length > 0 && post.tags.map((t) => `#${t}`).join(" "),
            post.commentCount > 0 && `댓글 ${post.commentCount}`,
            !hideRound && post.round && `${post.round.studyName} ${post.round.seq}회차`,
          ]}
        />
      }
    />
  );
}
