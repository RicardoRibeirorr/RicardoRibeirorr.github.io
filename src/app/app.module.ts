import { AuthorService } from './core/services/author.service';
import { PostShowPageComponent } from './ui/post/post-show-page/post-show-page.component';
import { HomePageComponent } from './ui/home/home-page.component';
import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { HttpClientModule } from '@angular/common/http';
import { AppRoutingModule } from './app-routing.module';
import { LocationStrategy, HashLocationStrategy } from '@angular/common';

import { AppComponent } from './app.component';
import { SharedModule } from './ui/shared/shared.module';

@NgModule({
  declarations: [
    AppComponent,
    HomePageComponent,
    PostShowPageComponent
  ],
  imports: [
    BrowserModule,
    AppRoutingModule,
    SharedModule,
    HttpClientModule
  ],
  providers: [AuthorService, {provide:LocationStrategy, useClass:HashLocationStrategy}],
  bootstrap: [AppComponent]
})
export class AppModule { }
