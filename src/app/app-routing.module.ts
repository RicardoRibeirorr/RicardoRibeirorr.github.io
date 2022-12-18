
import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { AboutPageComponent } from './ui/about/about-page.component';
import { PostShowPageComponent } from './ui/post/post-show-page/post-show-page.component';
import { PostPageComponent } from './ui/post/post-page/post-page.component';
import { HomePageComponent } from './ui/home/home-page.component';

const routes: Routes = [
  {path:"", component:HomePageComponent},
  {path:"about", component:AboutPageComponent},
  {path:"post", pathMatch:"full", component:PostPageComponent},
  {path:"post/:id", component:PostShowPageComponent},
];

@NgModule({
  imports: [RouterModule.forRoot(routes, { useHash: true })],
  exports: [RouterModule]
})
export class AppRoutingModule { }
