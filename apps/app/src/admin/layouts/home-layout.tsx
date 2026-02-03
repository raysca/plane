import { useEffect } from "react";
import { observer } from "mobx-react";
import { Outlet, useNavigate } from "react-router-dom";
import { useUser } from "../hooks/store/use-user";

function HomeLayout() {
  const navigate = useNavigate();
  const { isUserLoggedIn } = useUser();

  useEffect(() => {
    if (isUserLoggedIn === true) navigate("/general", { replace: true });
  }, [navigate, isUserLoggedIn]);

  return (
    <div className="relative z-10 flex flex-col items-center w-screen h-screen overflow-hidden overflow-y-auto pt-6 pb-10 px-8 bg-surface-1">
      <Outlet />
    </div>
  );
}

export default observer(HomeLayout);
