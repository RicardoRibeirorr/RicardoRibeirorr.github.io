import { Author } from './../../../core/interfaces/author';
import { Post } from 'src/app/core/interfaces/post';
import { PostService } from './../../../core/services/post.service';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { Meta } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import {PlatformLocation } from '@angular/common';
import {Title} from "@angular/platform-browser";

@Component({
  selector: 'app-post-show-page',
  templateUrl: './post-show-page.component.html',
  styleUrls: ['./post-show-page.component.scss']
})
export class PostShowPageComponent implements OnInit, OnDestroy {
  post!:Post;
  author!:Author;
  posts:Array<Post>=[];
  origin:string="";

  constructor(private router: Router, private routeActive: ActivatedRoute,
              private platformLocation: PlatformLocation, private postService:PostService,
              private metaService:Meta, private titleService:Title) {
    this.origin = (platformLocation as any).location.origin;
  }

  ngOnInit() {
    this.routeActive.params.subscribe(params => {
     this.postService.getPost(params['id']).subscribe((post:any)=>{
        if(post) this.post=post;
        else this.router.navigate(["/"]);

        this.fillAdjacentValues();
        this.addMetaTags();
      });

      this.postService.getPosts().subscribe(ps=>this.posts=ps.filter((p:Post)=>p.id !== params['id']).slice(0,3));
    });
  }

  ngOnDestroy() {
  }

  fillAdjacentValues(){
    this.post.imageUrl = this.post.image.indexOf("http")>-1?this.post.image:`${this.origin}${this.post.image}`;
    this.post.postUrl = `${this.origin}/post/${this.post.id}`;
  }

  addMetaTags(){
    this.titleService.setTitle(this.post.title);
    this.metaService.addTag({ name:'og:title',content:this.post.title});
    this.metaService.addTag({ name:'og:description',content:this.post.description});
    this.metaService.addTag({ name:'og:image', content:this.post.imageUrl||""});
    this.metaService.addTag({ name:'og:url', content:this.post.postUrl||""});
  }

}
