import { NavLink } from 'react-router';
import {
  Activity,
  ClipboardList,
  Dumbbell,
  Home,
  LogIn,
  PenLine,
  UserRound,
  UserPlus,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const primaryItems = [
  { to: '/', label: '홈', icon: Home },
  { to: '/posts', label: '운동 기록', icon: ClipboardList },
  { to: '/posts/new', label: '기록 작성', icon: PenLine },
  { to: '/users', label: '내 정보', icon: UserRound },
];

const authItems = [
  { to: '/login', label: '로그인', icon: LogIn },
  { to: '/signup', label: '회원가입', icon: UserPlus },
];

function SidebarLink({
  to,
  label,
  icon: Icon,
}: {
  to: string;
  label: string;
  icon: typeof Home;
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
          isActive && 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground',
        )
      }
    >
      <Icon className="h-4 w-4" />
      <span>{label}</span>
    </NavLink>
  );
}

export function Sidebar() {
  return (
    <aside className="border-b border-border bg-background lg:min-h-screen lg:border-b-0 lg:border-r">
      <div className="flex h-full flex-col gap-6 px-4 py-4 lg:px-5 lg:py-6">
        <NavLink to="/" className="flex items-center gap-3 rounded-md px-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Dumbbell className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold leading-5">AI Workout</span>
            <span className="block text-xs text-muted-foreground">기록 기반 성장 보드</span>
          </span>
        </NavLink>

        <nav className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
          {primaryItems.map((item) => (
            <SidebarLink key={item.to} {...item} />
          ))}
        </nav>

        <div className="hidden rounded-lg border border-border bg-muted/40 p-3 lg:block">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Activity className="h-4 w-4 text-primary" />
            점진적 과부하
          </div>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            이전 기록과 현재 기록을 비교해서 다음 운동 목표를 정리합니다.
          </p>
        </div>

        <nav className="flex gap-2 overflow-x-auto border-t border-border pt-4 lg:mt-auto lg:flex-col lg:overflow-visible">
          {authItems.map((item) => (
            <SidebarLink key={item.to} {...item} />
          ))}
        </nav>
      </div>
    </aside>
  );
}
